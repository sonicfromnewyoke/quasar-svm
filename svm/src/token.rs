use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_program_pack::Pack;
use spl_token::state::{Account as SplTokenAccount, Mint as SplMint, AccountState};

use crate::Account;

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

pub use spl_token::state::{Account as TokenAccount, Mint};

// ---------------------------------------------------------------------------
// Account factories
// ---------------------------------------------------------------------------

/// Create a system-owned account.
pub fn create_keyed_system_account(address: &Pubkey, lamports: u64) -> Account {
    Account {
        address: *address,
        lamports,
        data: vec![],
        owner: solana_sdk_ids::system_program::ID,
        executable: false,
    }
}

/// Create a pre-initialized mint account.
pub fn create_keyed_mint_account(address: &Pubkey, mint: &SplMint) -> Account {
    create_keyed_mint_account_with_program(address, mint, &crate::SPL_TOKEN_PROGRAM_ID)
}

/// Create a pre-initialized mint account with a specific token program.
#[inline(always)]
pub fn create_keyed_mint_account_with_program(address: &Pubkey, mint: &SplMint, token_program_id: &Pubkey) -> Account {
    let mut data = vec![0u8; SplMint::LEN];
    SplMint::pack(*mint, &mut data).unwrap();
    Account {
        address: *address,
        lamports: Rent::default().minimum_balance(SplMint::LEN),
        data,
        owner: *token_program_id,
        executable: false,
    }
}

/// Create a pre-initialized token account.
pub fn create_keyed_token_account(address: &Pubkey, token: &SplTokenAccount) -> Account {
    create_keyed_token_account_with_program(address, token, &crate::SPL_TOKEN_PROGRAM_ID)
}

/// Create a pre-initialized token account with a specific token program.
#[inline(always)]
pub fn create_keyed_token_account_with_program(address: &Pubkey, token: &SplTokenAccount, token_program_id: &Pubkey) -> Account {
    let mut data = vec![0u8; SplTokenAccount::LEN];
    SplTokenAccount::pack(*token, &mut data).unwrap();
    Account {
        address: *address,
        lamports: Rent::default().minimum_balance(SplTokenAccount::LEN),
        data,
        owner: *token_program_id,
        executable: false,
    }
}

/// Create a pre-initialized associated token account.
/// The address is derived from the wallet, mint, and token program.
pub fn create_keyed_associated_token_account(
    wallet: &Pubkey,
    mint: &Pubkey,
    amount: u64,
) -> Account {
    create_keyed_associated_token_account_with_program(wallet, mint, amount, &crate::SPL_TOKEN_PROGRAM_ID)
}

/// Create a pre-initialized associated token account with a specific token program.
/// The address is derived from the wallet, mint, and token program.
#[inline(always)]
pub fn create_keyed_associated_token_account_with_program(
    wallet: &Pubkey,
    mint: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> Account {
    let (ata, _bump) = Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            token_program_id.as_ref(),
            mint.as_ref(),
        ],
        &crate::SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    let token = SplTokenAccount {
        mint: *mint,
        owner: *wallet,
        amount,
        state: AccountState::Initialized,
        ..SplTokenAccount::default()
    };
    create_keyed_token_account_with_program(&ata, &token, token_program_id)
}
