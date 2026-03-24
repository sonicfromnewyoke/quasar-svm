//! Optimized message compilation for QuasarSVM.
//!
//! Bypasses `Message::new` (which uses `BTreeMap` + multiple `Vec::collect` allocations)
//! by building `SanitizedMessage` directly from stack-allocated `SmallVec`s.

use std::collections::HashSet;

use smallvec::SmallVec;

use solana_account::{Account as SolanaAccount, AccountSharedData};
use solana_hash::Hash;
use solana_instruction::{BorrowedAccountMeta, BorrowedInstruction, Instruction};
use solana_instructions_sysvar::construct_instructions_data;
use solana_message::compiled_instruction::CompiledInstruction;
use solana_message::{LegacyMessage, Message, SanitizedMessage};
use solana_pubkey::Pubkey;

struct KeyMeta {
    pubkey: Pubkey,
    is_signer: bool,
    is_writable: bool,
}

type KeyMetaVec = SmallVec<[KeyMeta; 16]>;

fn key_meta_find_or_insert<'a>(metas: &'a mut KeyMetaVec, pubkey: &Pubkey) -> &'a mut KeyMeta {
    let pos = metas.iter().position(|m| m.pubkey == *pubkey);
    match pos {
        Some(i) => &mut metas[i],
        None => {
            metas.push(KeyMeta {
                pubkey: *pubkey,
                is_signer: false,
                is_writable: false,
            });
            metas.last_mut().unwrap()
        }
    }
}

pub fn compile_message(instructions: &[Instruction]) -> SanitizedMessage {
    // Collect unique keys preserving insertion order
    let mut key_metas: KeyMetaVec = SmallVec::new();
    for ix in instructions {
        key_meta_find_or_insert(&mut key_metas, &ix.program_id);
        for meta in &ix.accounts {
            let km = key_meta_find_or_insert(&mut key_metas, &meta.pubkey);
            km.is_signer |= meta.is_signer;
            km.is_writable |= meta.is_writable;
        }
    }

    // Partition into Message layout buckets
    let mut writable_signers: SmallVec<[Pubkey; 4]> = SmallVec::new();
    let mut readonly_signers: SmallVec<[Pubkey; 4]> = SmallVec::new();
    let mut writable_non_signers: SmallVec<[Pubkey; 8]> = SmallVec::new();
    let mut readonly_non_signers: SmallVec<[Pubkey; 8]> = SmallVec::new();

    for km in &key_metas {
        match (km.is_signer, km.is_writable) {
            (true, true) => writable_signers.push(km.pubkey),
            (true, false) => readonly_signers.push(km.pubkey),
            (false, true) => writable_non_signers.push(km.pubkey),
            (false, false) => readonly_non_signers.push(km.pubkey),
        }
    }

    let num_required_signatures = (writable_signers.len() + readonly_signers.len()) as u8;
    let num_readonly_signed = readonly_signers.len() as u8;
    let num_readonly_unsigned = readonly_non_signers.len() as u8;

    let total_keys = writable_signers.len()
        + readonly_signers.len()
        + writable_non_signers.len()
        + readonly_non_signers.len();
    let mut account_keys: Vec<Pubkey> = Vec::with_capacity(total_keys);
    account_keys.extend_from_slice(&writable_signers);
    account_keys.extend_from_slice(&readonly_signers);
    account_keys.extend_from_slice(&writable_non_signers);
    account_keys.extend_from_slice(&readonly_non_signers);

    let compiled_instructions: Vec<CompiledInstruction> = instructions
        .iter()
        .map(|ix| {
            let program_id_index = account_keys
                .iter()
                .position(|k| *k == ix.program_id)
                .expect("program_id not found in account_keys — instruction set is inconsistent")
                as u8;
            let accounts: Vec<u8> = ix
                .accounts
                .iter()
                .map(|meta| {
                    account_keys
                        .iter()
                        .position(|k| *k == meta.pubkey)
                        .expect(
                            "account key not found in account_keys — instruction set is inconsistent",
                        ) as u8
                })
                .collect();
            CompiledInstruction {
                program_id_index,
                accounts,
                data: ix.data.clone(),
            }
        })
        .collect();

    let message = Message::new_with_compiled_instructions(
        num_required_signatures,
        num_readonly_signed,
        num_readonly_unsigned,
        account_keys,
        Hash::default(),
        compiled_instructions,
    );
    SanitizedMessage::Legacy(LegacyMessage::new(message, &HashSet::new()))
}

/// Collect unique program IDs from instructions into a stack-allocated `SmallVec`.
pub fn collect_program_ids(instructions: &[Instruction]) -> SmallVec<[Pubkey; 4]> {
    let mut ids: SmallVec<[Pubkey; 4]> = SmallVec::new();
    for ix in instructions {
        if !ids.contains(&ix.program_id) {
            ids.push(ix.program_id);
        }
    }
    ids
}

/// Build the instructions sysvar account from a slice of instructions.
pub fn build_instructions_sysvar(instructions: &[Instruction]) -> (Pubkey, SolanaAccount) {
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
        SolanaAccount {
            lamports: 0,
            data,
            owner: solana_sysvar_id::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
}

/// Build the instructions sysvar if it's not already in the provided accounts.
/// Returns `None` if the sysvar is already present.
pub fn maybe_build_instructions_sysvar(
    instructions: &[Instruction],
    accounts: &[(Pubkey, SolanaAccount)],
) -> Option<(Pubkey, AccountSharedData)> {
    let already_provided = accounts
        .iter()
        .any(|(k, _)| *k == solana_instructions_sysvar::ID);
    if already_provided {
        return None;
    }
    let (id, acct) = build_instructions_sysvar(instructions);
    Some((id, AccountSharedData::from(acct)))
}
