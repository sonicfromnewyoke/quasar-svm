use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use agave_feature_set::FeatureSet;
use agave_syscalls::{
    create_program_runtime_environment_v1, create_program_runtime_environment_v2,
};
use solana_account::{Account, AccountSharedData, ReadableAccount, WritableAccount};
use solana_compute_budget::compute_budget::ComputeBudget;
use solana_hash::Hash;
use solana_instruction::{BorrowedAccountMeta, BorrowedInstruction, Instruction};
use solana_instruction_error::InstructionError;
use solana_instructions_sysvar::construct_instructions_data;
use solana_message::{LegacyMessage, Message, SanitizedMessage};
use solana_program_runtime::invoke_context::{EnvironmentConfig, InvokeContext};
use solana_program_runtime::loaded_programs::ProgramRuntimeEnvironments;
use solana_program_runtime::sysvar_cache::SysvarCache;
use solana_pubkey::Pubkey;
use solana_svm_callback::InvokeContextCallback;
use solana_svm_log_collector::LogCollector;
use solana_svm_timings::ExecuteTimings;
use solana_svm_transaction::instruction::SVMInstruction;
use solana_transaction_context::{IndexOfAccount, TransactionContext};

use crate::program_cache::ProgramCache;
use crate::sysvars::Sysvars;

struct NoOpCallback;

impl InvokeContextCallback for NoOpCallback {
    fn get_epoch_stake(&self) -> u64 {
        0
    }
    fn get_epoch_stake_for_vote_account(&self, _: &Pubkey) -> u64 {
        0
    }
    fn is_precompile(&self, _: &Pubkey) -> bool {
        false
    }
    fn process_precompile(
        &self,
        _: &Pubkey,
        _: &[u8],
        _: Vec<&[u8]>,
    ) -> Result<(), solana_precompile_error::PrecompileError> {
        Ok(())
    }
}

pub struct ExecutionResult {
    pub compute_units_consumed: u64,
    pub execution_time_us: u64,
    pub raw_result: Result<(), InstructionError>,
    pub return_data: Vec<u8>,
    pub resulting_accounts: Vec<(Pubkey, Account)>,
}

pub struct QuasarSvm {
    pub compute_budget: ComputeBudget,
    pub feature_set: FeatureSet,
    pub logger: Option<Rc<RefCell<LogCollector>>>,
    pub program_cache: ProgramCache,
    pub sysvars: Sysvars,
}

impl Default for QuasarSvm {
    fn default() -> Self {
        Self::new()
    }
}

impl QuasarSvm {
    pub fn new() -> Self {
        let feature_set = FeatureSet::all_enabled();
        let compute_budget = ComputeBudget::new_with_defaults(true, true);
        let program_cache = ProgramCache::new(&feature_set, &compute_budget);

        Self {
            compute_budget,
            feature_set,
            logger: Some(LogCollector::new_ref()),
            program_cache,
            sysvars: Sysvars::default(),
        }
    }

    pub fn add_program(&self, program_id: &Pubkey, loader_key: &Pubkey, elf: &[u8]) {
        self.program_cache.add_program(program_id, loader_key, elf);
    }

    fn reset_logger(&mut self) {
        self.logger = Some(LogCollector::new_ref());
    }

    pub fn drain_logs(&self) -> Vec<String> {
        self.logger
            .as_ref()
            .map(|rc| rc.borrow().get_recorded_content().to_vec())
            .unwrap_or_default()
    }

    /// Build the instructions sysvar account.
    fn build_instructions_sysvar(instructions: &[Instruction]) -> (Pubkey, Account) {
        let data = construct_instructions_data(
            instructions
                .iter()
                .map(|ix| BorrowedInstruction {
                    program_id: &ix.program_id,
                    accounts: ix
                        .accounts
                        .iter()
                        .map(|meta| BorrowedAccountMeta {
                            pubkey: &meta.pubkey,
                            is_signer: meta.is_signer,
                            is_writable: meta.is_writable,
                        })
                        .collect(),
                    data: &ix.data,
                })
                .collect::<Vec<_>>()
                .as_slice(),
        );
        (
            solana_instructions_sysvar::ID,
            Account {
                lamports: 0,
                data,
                owner: solana_sysvar_id::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
    }

    /// Compile accounts into the format needed by TransactionContext.
    fn compile_accounts(
        &self,
        instructions: &[Instruction],
        accounts: &[(Pubkey, Account)],
    ) -> (SanitizedMessage, Vec<(Pubkey, AccountSharedData)>) {
        let message = Message::new(instructions, None);
        let sanitized_message =
            SanitizedMessage::Legacy(LegacyMessage::new(message, &HashSet::new()));

        let program_ids: HashSet<Pubkey> = instructions.iter().map(|ix| ix.program_id).collect();
        let account_keys: HashSet<&Pubkey> = accounts.iter().map(|(k, _)| k).collect();

        // Build fallback accounts for programs and sysvars not in the provided list.
        let mut fallbacks = HashMap::new();

        for pid in &program_ids {
            if !account_keys.contains(pid) {
                let program_accounts = self.program_cache.maybe_create_program_accounts(pid);
                if program_accounts.is_empty() {
                    let mut stub = Account::default();
                    stub.set_executable(true);
                    fallbacks.insert(*pid, stub);
                } else {
                    for (key, acct) in program_accounts {
                        fallbacks.insert(key, acct);
                    }
                }
            }
        }

        // Instructions sysvar fallback.
        if !account_keys.contains(&solana_instructions_sysvar::ID) {
            let (id, acct) = Self::build_instructions_sysvar(instructions);
            fallbacks.insert(id, acct);
        }

        let transaction_accounts = sanitized_message
            .account_keys()
            .iter()
            .map(|key| {
                // Try provided accounts first.
                if let Some((_, a)) = accounts.iter().find(|(k, _)| k == key) {
                    return (*key, AccountSharedData::from(a.clone()));
                }
                // Then try fallbacks (already built for top-level program IDs).
                if let Some(a) = fallbacks.get(key) {
                    return (*key, AccountSharedData::from(a.clone()));
                }
                // Sysvar fallback.
                if let Some(a) = self.sysvars.maybe_create_sysvar_account(key) {
                    return (*key, AccountSharedData::from(a));
                }
                // Program account fallback (for CPI targets not in top-level instructions).
                let program_accounts = self.program_cache.maybe_create_program_accounts(key);
                if let Some((_, a)) = program_accounts.into_iter().find(|(k, _)| k == key) {
                    return (*key, AccountSharedData::from(a));
                }
                // Empty account as last resort.
                (*key, AccountSharedData::default())
            })
            .collect();

        (sanitized_message, transaction_accounts)
    }

    fn deconstruct_resulting_accounts(
        transaction_context: &TransactionContext,
        original_accounts: &[(Pubkey, Account)],
    ) -> Vec<(Pubkey, Account)> {
        original_accounts
            .iter()
            .map(|(pubkey, account)| {
                transaction_context
                    .find_index_of_account(pubkey)
                    .map(|index| {
                        let account_ref = transaction_context.accounts().try_borrow(index).unwrap();
                        let resulting_account = Account {
                            lamports: account_ref.lamports(),
                            data: account_ref.data().to_vec(),
                            owner: *account_ref.owner(),
                            executable: account_ref.executable(),
                            rent_epoch: account_ref.rent_epoch(),
                        };
                        (*pubkey, resulting_account)
                    })
                    .unwrap_or((*pubkey, account.clone()))
            })
            .collect()
    }

    fn process_message<'a>(
        &self,
        sanitized_message: &'a SanitizedMessage,
        transaction_context: &mut TransactionContext<'a>,
        sysvar_cache: &SysvarCache,
    ) -> (u64, u64, Result<(), InstructionError>, Vec<u8>) {
        let mut compute_units_consumed = 0u64;
        let mut timings = ExecuteTimings::default();

        let mut program_cache = self.program_cache.cache();
        let execution_budget = self.compute_budget.to_budget();
        let runtime_features = self.feature_set.runtime_features();

        let program_runtime_environments = ProgramRuntimeEnvironments {
            program_runtime_v1: Arc::new(
                create_program_runtime_environment_v1(
                    &runtime_features,
                    &execution_budget,
                    false,
                    false,
                )
                .unwrap(),
            ),
            program_runtime_v2: Arc::new(create_program_runtime_environment_v2(
                &execution_budget,
                false,
            )),
        };

        let callback = NoOpCallback;

        let mut invoke_context = InvokeContext::new(
            transaction_context,
            &mut program_cache,
            EnvironmentConfig::new(
                Hash::default(),
                5000,
                &callback,
                &runtime_features,
                &program_runtime_environments,
                &program_runtime_environments,
                sysvar_cache,
            ),
            self.logger.clone(),
            self.compute_budget.to_budget(),
            self.compute_budget.to_cost(),
        );

        let mut raw_result: Result<(), InstructionError> = Ok(());

        for (_program_id, compiled_ix) in sanitized_message.program_instructions_iter() {
            let program_id_index = compiled_ix.program_id_index as IndexOfAccount;

            invoke_context
                .prepare_next_top_level_instruction(
                    sanitized_message,
                    &SVMInstruction::from(compiled_ix),
                    program_id_index,
                    &compiled_ix.data,
                )
                .expect("failed to prepare instruction");

            let mut compute_units_consumed_ix = 0u64;
            let invoke_result =
                invoke_context.process_instruction(&mut compute_units_consumed_ix, &mut timings);

            compute_units_consumed += compute_units_consumed_ix;

            if let Err(err) = invoke_result {
                raw_result = Err(err);
                break;
            }
        }

        let return_data = transaction_context.get_return_data().1.to_vec();

        (
            compute_units_consumed,
            timings.details.execute_us.0,
            raw_result,
            return_data,
        )
    }

    /// Execute one or more instructions with shared accounts.
    /// Account state persists between instructions. Non-atomic.
    pub fn process_instructions(
        &mut self,
        instructions: &[Instruction],
        accounts: &[(Pubkey, Account)],
    ) -> ExecutionResult {
        self.reset_logger();

        let mut current_accounts = accounts.to_vec();
        let mut total_compute_units = 0u64;
        let mut total_execution_time = 0u64;
        let mut last_raw_result: Result<(), InstructionError> = Ok(());
        let mut last_return_data = Vec::new();

        let sysvar_cache = self.sysvars.setup_sysvar_cache(accounts);

        for instruction in instructions {
            let (sanitized_message, transaction_accounts) =
                self.compile_accounts(std::slice::from_ref(instruction), &current_accounts);

            let mut transaction_context = TransactionContext::new(
                transaction_accounts,
                self.sysvars.rent.clone(),
                self.compute_budget.max_instruction_stack_depth,
                self.compute_budget.max_instruction_trace_length,
            );

            let (cu, time, result, ret_data) =
                self.process_message(&sanitized_message, &mut transaction_context, &sysvar_cache);

            total_compute_units += cu;
            total_execution_time += time;
            last_return_data = ret_data;

            if result.is_ok() {
                current_accounts =
                    Self::deconstruct_resulting_accounts(&transaction_context, &current_accounts);
            }

            last_raw_result = result;
            if last_raw_result.is_err() {
                break;
            }
        }

        ExecutionResult {
            compute_units_consumed: total_compute_units,
            execution_time_us: total_execution_time,
            raw_result: last_raw_result,
            return_data: last_return_data,
            resulting_accounts: current_accounts,
        }
    }

    /// Execute multiple instructions as a single atomic transaction.
    pub fn process_transaction(
        &mut self,
        instructions: &[Instruction],
        accounts: &[(Pubkey, Account)],
    ) -> ExecutionResult {
        self.reset_logger();

        let (sanitized_message, transaction_accounts) =
            self.compile_accounts(instructions, accounts);

        let mut transaction_context = TransactionContext::new(
            transaction_accounts,
            self.sysvars.rent.clone(),
            self.compute_budget.max_instruction_stack_depth,
            self.compute_budget.max_instruction_trace_length,
        );

        let sysvar_cache = self.sysvars.setup_sysvar_cache(accounts);

        let (compute_units_consumed, execution_time_us, raw_result, return_data) =
            self.process_message(&sanitized_message, &mut transaction_context, &sysvar_cache);

        let resulting_accounts = if raw_result.is_ok() {
            Self::deconstruct_resulting_accounts(&transaction_context, accounts)
        } else {
            accounts.to_vec()
        };

        ExecutionResult {
            compute_units_consumed,
            execution_time_us,
            raw_result,
            return_data,
            resulting_accounts,
        }
    }
}
