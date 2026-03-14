mod program_cache;
mod svm;
mod sysvars;

pub use solana_account::Account;
pub use solana_clock::Clock;
pub use solana_instruction::Instruction;
pub use solana_instruction_error::InstructionError;
pub use solana_pubkey::Pubkey;
pub use solana_rent::Rent;
pub use solana_sdk_ids;

pub use crate::program_cache::loader_keys;
pub use crate::svm::{ExecutionResult, QuasarSvm};
pub use crate::sysvars::Sysvars;

// ---------------------------------------------------------------------------
// Bundled SPL programs
// ---------------------------------------------------------------------------

pub const SPL_TOKEN_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const SPL_TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const SPL_ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// ---------------------------------------------------------------------------
// Builder-style helpers on QuasarSvm
// ---------------------------------------------------------------------------

impl QuasarSvm {
    /// Load a BPF program from an ELF byte slice (loader v3 / upgradeable).
    pub fn with_program(self, program_id: &Pubkey, elf: &[u8]) -> Self {
        self.add_program(program_id, &loader_keys::LOADER_V3, elf);
        self
    }

    /// Load a BPF program with a specific loader version.
    pub fn with_program_loader(self, program_id: &Pubkey, loader: &Pubkey, elf: &[u8]) -> Self {
        self.add_program(program_id, loader, elf);
        self
    }

    /// No-op — system program is already built in. Exists for parity with
    /// the TypeScript API.
    pub fn with_system_program(self) -> Self {
        self
    }

    /// Load the bundled SPL Token program.
    pub fn with_token_program(self) -> Self {
        let elf = include_bytes!("../../programs/spl_token.so");
        self.with_program_loader(&SPL_TOKEN_PROGRAM_ID, &loader_keys::LOADER_V2, elf)
    }

    /// Load the bundled SPL Token 2022 program.
    pub fn with_token_2022_program(self) -> Self {
        let elf = include_bytes!("../../programs/spl_token_2022.so");
        self.with_program(&SPL_TOKEN_2022_PROGRAM_ID, elf)
    }

    /// Load the bundled SPL Associated Token program.
    pub fn with_associated_token_program(self) -> Self {
        let elf = include_bytes!("../../programs/spl_associated_token.so");
        self.with_program_loader(
            &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
            &loader_keys::LOADER_V2,
            elf,
        )
    }

    /// Set the clock slot (convenience for `sysvars.warp_to_slot`).
    pub fn with_slot(mut self, slot: u64) -> Self {
        self.sysvars.warp_to_slot(slot);
        self
    }
}

// ---------------------------------------------------------------------------
// Ergonomic helpers on ExecutionResult
// ---------------------------------------------------------------------------

impl ExecutionResult {
    /// Returns `true` if all instructions succeeded.
    pub fn is_ok(&self) -> bool {
        self.raw_result.is_ok()
    }

    /// Returns `true` if any instruction failed.
    pub fn is_err(&self) -> bool {
        self.raw_result.is_err()
    }

    /// Unwrap the result, panicking with the error if execution failed.
    pub fn unwrap(&self) {
        if let Err(ref e) = self.raw_result {
            panic!("execution failed: {e:?}");
        }
    }

    /// Unwrap with a custom message.
    pub fn expect(&self, msg: &str) {
        if let Err(ref e) = self.raw_result {
            panic!("{msg}: {e:?}");
        }
    }

    /// Look up a resulting account by pubkey.
    pub fn account(&self, pubkey: &Pubkey) -> Option<&Account> {
        self.resulting_accounts
            .iter()
            .find(|(k, _)| k == pubkey)
            .map(|(_, a)| a)
    }
}
