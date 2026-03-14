use solana_account::Account;
use solana_pubkey::Pubkey;
use solana_rent::Rent;

use crate::{SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID};

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

/// SPL Token Mint state for creating pre-initialized mint accounts.
#[derive(Debug, Clone)]
pub struct Mint {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub freeze_authority: Option<Pubkey>,
}

impl Default for Mint {
    fn default() -> Self {
        Self {
            mint_authority: None,
            supply: 0,
            decimals: 9,
            freeze_authority: None,
        }
    }
}

impl Mint {
    pub const LEN: usize = 82;

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = vec![0u8; Self::LEN];
        let mut o = 0;

        // COption<Pubkey> mint_authority
        pack_coption_pubkey(&self.mint_authority, &mut buf, &mut o);
        // u64 supply
        buf[o..o + 8].copy_from_slice(&self.supply.to_le_bytes());
        o += 8;
        // u8 decimals
        buf[o] = self.decimals;
        o += 1;
        // bool is_initialized (always true when we pack)
        buf[o] = 1;
        o += 1;
        // COption<Pubkey> freeze_authority
        pack_coption_pubkey(&self.freeze_authority, &mut buf, &mut o);
        debug_assert_eq!(o, Self::LEN);

        buf
    }
}

// ---------------------------------------------------------------------------
// Token (Account)
// ---------------------------------------------------------------------------

/// SPL Token Account state for creating pre-initialized token accounts.
#[derive(Debug, Clone)]
pub struct Token {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub delegate: Option<Pubkey>,
    pub state: TokenAccountState,
    pub is_native: Option<u64>,
    pub delegated_amount: u64,
    pub close_authority: Option<Pubkey>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenAccountState {
    Uninitialized = 0,
    Initialized = 1,
    Frozen = 2,
}

impl Default for TokenAccountState {
    fn default() -> Self {
        Self::Initialized
    }
}

impl Token {
    pub const LEN: usize = 165;

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = vec![0u8; Self::LEN];
        let mut o = 0;

        // Pubkey mint
        buf[o..o + 32].copy_from_slice(self.mint.as_ref());
        o += 32;
        // Pubkey owner
        buf[o..o + 32].copy_from_slice(self.owner.as_ref());
        o += 32;
        // u64 amount
        buf[o..o + 8].copy_from_slice(&self.amount.to_le_bytes());
        o += 8;
        // COption<Pubkey> delegate
        pack_coption_pubkey(&self.delegate, &mut buf, &mut o);
        // u8 state
        buf[o] = self.state as u8;
        o += 1;
        // COption<u64> is_native
        pack_coption_u64(&self.is_native, &mut buf, &mut o);
        // u64 delegated_amount
        buf[o..o + 8].copy_from_slice(&self.delegated_amount.to_le_bytes());
        o += 8;
        // COption<Pubkey> close_authority
        pack_coption_pubkey(&self.close_authority, &mut buf, &mut o);
        debug_assert_eq!(o, Self::LEN);

        buf
    }
}

// ---------------------------------------------------------------------------
// Pack helpers
// ---------------------------------------------------------------------------

fn pack_coption_pubkey(opt: &Option<Pubkey>, buf: &mut [u8], o: &mut usize) {
    match opt {
        Some(key) => {
            buf[*o..*o + 4].copy_from_slice(&1u32.to_le_bytes());
            *o += 4;
            buf[*o..*o + 32].copy_from_slice(key.as_ref());
            *o += 32;
        }
        None => {
            buf[*o..*o + 4].copy_from_slice(&0u32.to_le_bytes());
            *o += 4;
            // 32 bytes of zero already there
            *o += 32;
        }
    }
}

fn pack_coption_u64(opt: &Option<u64>, buf: &mut [u8], o: &mut usize) {
    match opt {
        Some(val) => {
            buf[*o..*o + 4].copy_from_slice(&1u32.to_le_bytes());
            *o += 4;
            buf[*o..*o + 8].copy_from_slice(&val.to_le_bytes());
            *o += 8;
        }
        None => {
            buf[*o..*o + 4].copy_from_slice(&0u32.to_le_bytes());
            *o += 4;
            // 8 bytes of zero already there
            *o += 8;
        }
    }
}

// ---------------------------------------------------------------------------
// QuasarSvm helpers
// ---------------------------------------------------------------------------

use crate::QuasarSvm;

impl QuasarSvm {
    /// Store a pre-initialized SPL Token mint account.
    pub fn add_mint_account(&mut self, pubkey: &Pubkey, mint: &Mint) {
        let data = mint.pack();
        let account = Account {
            lamports: Rent::default().minimum_balance(Mint::LEN),
            data,
            owner: SPL_TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        };
        self.set_account(*pubkey, account);
    }

    /// Store a pre-initialized SPL Token token account.
    pub fn add_token_account(&mut self, pubkey: &Pubkey, token: &Token) {
        let data = token.pack();
        let account = Account {
            lamports: Rent::default().minimum_balance(Token::LEN),
            data,
            owner: SPL_TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        };
        self.set_account(*pubkey, account);
    }

    /// Store a pre-initialized Token-2022 mint account.
    pub fn add_mint_account_2022(&mut self, pubkey: &Pubkey, mint: &Mint) {
        let data = mint.pack();
        let account = Account {
            lamports: Rent::default().minimum_balance(Mint::LEN),
            data,
            owner: SPL_TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        };
        self.set_account(*pubkey, account);
    }

    /// Store a pre-initialized Token-2022 token account.
    pub fn add_token_account_2022(&mut self, pubkey: &Pubkey, token: &Token) {
        let data = token.pack();
        let account = Account {
            lamports: Rent::default().minimum_balance(Token::LEN),
            data,
            owner: SPL_TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        };
        self.set_account(*pubkey, account);
    }

    /// Builder-style: store a pre-initialized SPL Token mint account.
    pub fn with_mint_account(mut self, pubkey: &Pubkey, mint: &Mint) -> Self {
        self.add_mint_account(pubkey, mint);
        self
    }

    /// Builder-style: store a pre-initialized SPL Token token account.
    pub fn with_token_account(mut self, pubkey: &Pubkey, token: &Token) -> Self {
        self.add_token_account(pubkey, token);
        self
    }
}
