use solana_account::Account;
use solana_pubkey::Pubkey;

use crate::token::{
    create_associated_token_account, create_system_account, get_associated_token_address,
};

/// A test user with a system account and optional token accounts.
pub struct User {
    pub pubkey: Pubkey,
    system: (Pubkey, Account),
    tokens: Vec<TokenPosition>,
}

struct TokenPosition {
    mint: Pubkey,
    ata: Pubkey,
    account: Account,
}

/// Token balance to initialize for a user.
pub struct UserToken {
    pub mint: Pubkey,
    pub amount: u64,
    pub token_program_id: Pubkey,
}

impl UserToken {
    pub fn new(mint: &Pubkey, amount: u64, token_program_id: &Pubkey) -> Self {
        Self {
            mint: *mint,
            amount,
            token_program_id: *token_program_id,
        }
    }

    /// SPL Token account shorthand.
    pub fn spl(mint: &Pubkey, amount: u64) -> Self {
        Self::new(mint, amount, &crate::SPL_TOKEN_PROGRAM_ID)
    }

    /// Token-2022 account shorthand.
    pub fn spl_2022(mint: &Pubkey, amount: u64) -> Self {
        Self::new(mint, amount, &crate::SPL_TOKEN_2022_PROGRAM_ID)
    }
}

impl User {
    /// Create a new test user with the given SOL balance and token positions.
    pub fn new(lamports: u64, tokens: &[UserToken]) -> Self {
        let pubkey = Pubkey::new_unique();
        let system = (pubkey, create_system_account(lamports));
        let tokens = tokens
            .iter()
            .map(|t| {
                let (ata, account) = create_associated_token_account(
                    &pubkey,
                    &t.mint,
                    t.amount,
                    &t.token_program_id,
                );
                TokenPosition {
                    mint: t.mint,
                    ata,
                    account,
                }
            })
            .collect();
        Self {
            pubkey,
            system,
            tokens,
        }
    }

    /// Get the ATA address for a given mint.
    pub fn ata(&self, mint: &Pubkey) -> Pubkey {
        self.tokens
            .iter()
            .find(|t| t.mint == *mint)
            .map(|t| t.ata)
            .unwrap_or_else(|| {
                // Derive even if not pre-initialized
                get_associated_token_address(
                    &self.pubkey,
                    mint,
                    &crate::SPL_TOKEN_PROGRAM_ID,
                )
            })
    }

    /// Flatten all accounts (system + token) into a `Vec<(Pubkey, Account)>`.
    pub fn accounts(&self) -> Vec<(Pubkey, Account)> {
        let mut out = vec![self.system.clone()];
        for t in &self.tokens {
            out.push((t.ata, t.account.clone()));
        }
        out
    }
}
