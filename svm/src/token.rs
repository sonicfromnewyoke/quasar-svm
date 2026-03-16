use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_program_pack::Pack;
use spl_token::state::{Account as SplTokenAccount, Mint as SplMint, AccountState};

use crate::Account;

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

pub use spl_token::state::{Account as TokenAccount, Mint, AccountState as TokenAccountState};

// ---------------------------------------------------------------------------
// Account factories
// ---------------------------------------------------------------------------

/// Create a system-owned account with a unique address.
pub fn create_system_account(lamports: u64) -> Account {
    create_system_account_at(&Pubkey::new_unique(), lamports)
}

/// Create a system-owned account at a specific address.
pub fn create_system_account_at(pubkey: &Pubkey, lamports: u64) -> Account {
    Account {
        address: *pubkey,
        lamports,
        data: vec![],
        owner: solana_sdk_ids::system_program::ID,
        executable: false,
    }
}

/// Create a pre-initialized mint account with a unique address.
pub fn create_mint_account(mint: &SplMint, token_program_id: &Pubkey) -> Account {
    create_mint_account_at(&Pubkey::new_unique(), mint, token_program_id)
}

/// Create a pre-initialized mint account at a specific address.
pub fn create_mint_account_at(pubkey: &Pubkey, mint: &SplMint, token_program_id: &Pubkey) -> Account {
    let mut data = vec![0u8; SplMint::LEN];
    SplMint::pack(*mint, &mut data).unwrap();
    Account {
        address: *pubkey,
        lamports: Rent::default().minimum_balance(SplMint::LEN),
        data,
        owner: *token_program_id,
        executable: false,
    }
}

/// Create a pre-initialized token account with a unique address.
pub fn create_token_account(token: &SplTokenAccount, token_program_id: &Pubkey) -> Account {
    create_token_account_at(&Pubkey::new_unique(), token, token_program_id)
}

/// Create a pre-initialized token account at a specific address.
pub fn create_token_account_at(pubkey: &Pubkey, token: &SplTokenAccount, token_program_id: &Pubkey) -> Account {
    let mut data = vec![0u8; SplTokenAccount::LEN];
    SplTokenAccount::pack(*token, &mut data).unwrap();
    Account {
        address: *pubkey,
        lamports: Rent::default().minimum_balance(SplTokenAccount::LEN),
        data,
        owner: *token_program_id,
        executable: false,
    }
}

/// Create a pre-initialized associated token account.
/// The address is derived from the wallet, mint, and token program.
pub fn create_associated_token_account(
    wallet: &Pubkey,
    mint: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> Account {
    let ata = get_associated_token_address(wallet, mint, token_program_id);
    let token = SplTokenAccount {
        mint: *mint,
        owner: *wallet,
        amount,
        state: AccountState::Initialized,
        ..SplTokenAccount::default()
    };
    create_token_account_at(&ata, &token, token_program_id)
}

// ---------------------------------------------------------------------------
// ExecutionResult token helpers
// ---------------------------------------------------------------------------

impl crate::ExecutionResult {
    /// Unpack a token account from the resulting accounts.
    pub fn token_account(&self, address: &Pubkey) -> Option<SplTokenAccount> {
        self.account(address).and_then(|a| SplTokenAccount::unpack(&a.data).ok())
    }

    /// Unpack a mint account from the resulting accounts.
    pub fn mint_account(&self, address: &Pubkey) -> Option<SplMint> {
        self.account(address).and_then(|a| SplMint::unpack(&a.data).ok())
    }

    /// Get the token balance (amount) of a token account.
    pub fn token_balance(&self, address: &Pubkey) -> Option<u64> {
        self.token_account(address).map(|t| t.amount)
    }

    /// Get the supply of a mint account.
    pub fn mint_supply(&self, address: &Pubkey) -> Option<u64> {
        self.mint_account(address).map(|m| m.supply)
    }
}

// ---------------------------------------------------------------------------

/// Derive the associated token account address.
pub fn get_associated_token_address(
    wallet: &Pubkey,
    mint: &Pubkey,
    token_program_id: &Pubkey,
) -> Pubkey {
    let (ata, _bump) = Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            token_program_id.as_ref(),
            mint.as_ref(),
        ],
        &crate::SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    ata
}
