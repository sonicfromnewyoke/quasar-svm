use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use solana_rent::Rent;

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

    pub fn unpack(data: &[u8]) -> Option<Self> {
        if data.len() < Self::LEN {
            return None;
        }
        let mut o = 0;
        let mint_authority = unpack_coption_pubkey(data, &mut o);
        let supply = u64::from_le_bytes(data[o..o + 8].try_into().ok()?);
        o += 8;
        let decimals = data[o];
        o += 1;
        let is_initialized = data[o] != 0;
        o += 1;
        if !is_initialized {
            return None;
        }
        let freeze_authority = unpack_coption_pubkey(data, &mut o);
        Some(Self { mint_authority, supply, decimals, freeze_authority })
    }

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TokenAccountState {
    Uninitialized = 0,
    #[default]
    Initialized = 1,
    Frozen = 2,
}

impl Default for Token {
    fn default() -> Self {
        Self {
            mint: Pubkey::default(),
            owner: Pubkey::default(),
            amount: 0,
            delegate: None,
            state: TokenAccountState::Initialized,
            is_native: None,
            delegated_amount: 0,
            close_authority: None,
        }
    }
}

impl Token {
    pub const LEN: usize = 165;

    pub fn unpack(data: &[u8]) -> Option<Self> {
        if data.len() < Self::LEN {
            return None;
        }
        let mut o = 0;
        let mint = Pubkey::new_from_array(data[o..o + 32].try_into().ok()?);
        o += 32;
        let owner = Pubkey::new_from_array(data[o..o + 32].try_into().ok()?);
        o += 32;
        let amount = u64::from_le_bytes(data[o..o + 8].try_into().ok()?);
        o += 8;
        let delegate = unpack_coption_pubkey(data, &mut o);
        let state = match data[o] {
            0 => TokenAccountState::Uninitialized,
            1 => TokenAccountState::Initialized,
            2 => TokenAccountState::Frozen,
            _ => return None,
        };
        o += 1;
        let is_native = unpack_coption_u64(data, &mut o);
        let delegated_amount = u64::from_le_bytes(data[o..o + 8].try_into().ok()?);
        o += 8;
        let close_authority = unpack_coption_pubkey(data, &mut o);
        Some(Self {
            mint, owner, amount, delegate, state,
            is_native, delegated_amount, close_authority,
        })
    }

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

fn unpack_coption_pubkey(data: &[u8], o: &mut usize) -> Option<Pubkey> {
    let tag = u32::from_le_bytes(data[*o..*o + 4].try_into().unwrap());
    *o += 4;
    let key = Pubkey::new_from_array(data[*o..*o + 32].try_into().unwrap());
    *o += 32;
    if tag == 1 { Some(key) } else { None }
}

fn unpack_coption_u64(data: &[u8], o: &mut usize) -> Option<u64> {
    let tag = u32::from_le_bytes(data[*o..*o + 4].try_into().unwrap());
    *o += 4;
    let val = u64::from_le_bytes(data[*o..*o + 8].try_into().unwrap());
    *o += 8;
    if tag == 1 { Some(val) } else { None }
}

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
// Account factories (standalone — no QuasarSvm needed)
// ---------------------------------------------------------------------------

/// Create a system-owned account with the given lamports.
pub fn create_system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: solana_sdk_ids::system_program::ID,
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a pre-initialized mint account.
pub fn create_mint_account(mint: &Mint, token_program_id: &Pubkey) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(Mint::LEN),
        data: mint.pack(),
        owner: *token_program_id,
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a pre-initialized token account.
pub fn create_token_account(token: &Token, token_program_id: &Pubkey) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(Token::LEN),
        data: token.pack(),
        owner: *token_program_id,
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a pre-initialized associated token account.
/// Returns `(ata_pubkey, account)`.
pub fn create_associated_token_account(
    wallet: &Pubkey,
    mint: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> (Pubkey, Account) {
    let ata = get_associated_token_address(wallet, mint, token_program_id);
    let token = Token {
        mint: *mint,
        owner: *wallet,
        amount,
        ..Default::default()
    };
    (ata, create_token_account(&token, token_program_id))
}

// ---------------------------------------------------------------------------
// Token instruction builders
// ---------------------------------------------------------------------------

/// Build an SPL Token Transfer instruction.
pub fn token_transfer(
    source: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> Instruction {
    let mut data = vec![3u8]; // Transfer = 3
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program_id,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Build an SPL Token MintTo instruction.
pub fn token_mint_to(
    mint: &Pubkey,
    destination: &Pubkey,
    mint_authority: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> Instruction {
    let mut data = vec![7u8]; // MintTo = 7
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program_id,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*mint_authority, true),
        ],
        data,
    }
}

/// Build an SPL Token Burn instruction.
pub fn token_burn(
    source: &Pubkey,
    mint: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    token_program_id: &Pubkey,
) -> Instruction {
    let mut data = vec![8u8]; // Burn = 8
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: *token_program_id,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*mint, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

// ---------------------------------------------------------------------------
// ExecutionResult token helpers
// ---------------------------------------------------------------------------

impl crate::ExecutionResult {
    /// Unpack a token account from the resulting accounts.
    pub fn token_account(&self, pubkey: &Pubkey) -> Option<Token> {
        self.account(pubkey).and_then(|a| Token::unpack(&a.data))
    }

    /// Unpack a mint account from the resulting accounts.
    pub fn mint_account(&self, pubkey: &Pubkey) -> Option<Mint> {
        self.account(pubkey).and_then(|a| Mint::unpack(&a.data))
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
