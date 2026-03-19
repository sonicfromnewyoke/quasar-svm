# QuasarSVM - Rust API

QuasarSVM is a lightweight Solana virtual machine that executes transactions locally without an RPC connection or validator. Provide program ELFs, account state, and instructions — get back logs, compute units, return data, and resulting accounts.

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
quasar-svm = "0.1"
```

## Quick Start

```rust
use quasar_svm::{QuasarSvm, Pubkey, SPL_TOKEN_PROGRAM_ID};
use quasar_svm::token::*;
use spl_token::state::Account as SplTokenAccount;
use solana_program_pack::Pack;

let authority = Pubkey::new_unique();

let mint = create_keyed_mint_account(&Pubkey::new_unique(), &Mint { decimals: 6, supply: 10_000, ..Default::default() });
let alice = create_keyed_associated_token_account(&authority, &mint.address, 5_000);
let bob   = create_keyed_associated_token_account(&Pubkey::new_unique(), &mint.address, 0);

let ix = spl_token::instruction::transfer(
    &SPL_TOKEN_PROGRAM_ID,
    &alice.address,
    &bob.address,
    &authority,
    &[],
    1_000,
).unwrap();

let mut svm = QuasarSvm::new(); // SPL programs loaded by default

let result = svm.process_instruction(&ix, &[mint, alice, bob]);

result.assert_success();

// Verify by unpacking account data
let bob_account = result.account(&bob.address).unwrap();
let bob_token = SplTokenAccount::unpack(&bob_account.data).unwrap();
assert_eq!(bob_token.amount, 1_000);
```

## Architecture

QuasarSVM is built as a C FFI wrapper around the low-level Solana SVM execution pipeline. It directly uses:
- `solana-program-runtime`
- `solana-bpf-loader-program`
- `agave-syscalls`

The system produces `libquasar_svm.dylib/.so/.dll` and `include/quasar_svm.h` for FFI integration. SPL Token, Token-2022, and Associated Token Account program binaries are embedded via `include_bytes!`.

## Core API

### QuasarSvm

#### Creating a VM

```rust
let svm = QuasarSvm::new();
```

All SPL programs load by default.

**To disable specific programs:**

```rust
use quasar_svm::QuasarSvmConfig;

let svm = QuasarSvm::new_with_config(QuasarSvmConfig {
    token: true,             // default: true
    token_2022: false,       // disable Token-2022
    associated_token: true,  // default: true
});
```

**Or load programs manually:**

```rust
let svm = QuasarSvm::new_with_config(QuasarSvmConfig {
    token: false,
    token_2022: false,
    associated_token: false,
})
.with_token_program()
.with_token_2022_program()
.with_associated_token_program();
```

#### Loading Programs

Load a custom program from an ELF binary:

```rust
let elf = std::fs::read("target/deploy/my_program.so").unwrap();
svm.add_program(&program_id, &loader_keys::LOADER_V3, &elf);

// Builder-style
let svm = QuasarSvm::new()
    .with_program(&program_id, &elf)
    .with_program_loader(&program_id, &loader_keys::LOADER_V2, &elf);
```

Load bundled SPL programs:

```rust
let svm = QuasarSvm::new()
    .with_token_program()
    .with_token_2022_program()
    .with_associated_token_program();
```

#### Executing Instructions

Two execution methods — single or chain:

| Method | Behavior |
|--------|----------|
| `process_instruction` | Execute one instruction atomically. |
| `process_instruction_chain` | Execute multiple instructions as one atomic chain. |

```rust
// Single instruction
let result = svm.process_instruction(&ix, &accounts);

// Multiple instructions — atomic
let result = svm.process_instruction_chain(&[ix1, ix2], &accounts);
```

Accounts are `&[Account]` — a slice of `Account` structs.

#### Sysvars

```rust
svm.sysvars.warp_to_slot(200);          // updates clock.slot + slot_hashes
svm.set_clock(clock);
svm.set_rent(rent);
svm.set_epoch_schedule(epoch_schedule);
svm.set_compute_budget(200_000);
```

### ExecutionResult

Every execution returns an `ExecutionResult` struct with methods for inspecting the execution outcome.

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `raw_result` | `Result<(), InstructionError>` | Status of the execution |
| `compute_units_consumed` | `u64` | Compute units used |
| `execution_time_us` | `u64` | Execution time in microseconds |
| `return_data` | `Vec<u8>` | Program return data |
| `resulting_accounts` | `Vec<Account>` | Resulting account states |
| `logs` | `Vec<String>` | Execution logs |

#### Assertion Methods

```rust
result.assert_success();
result.assert_error(ProgramError::InsufficientFunds);
assert!(result.is_success());
assert!(result.is_error());
result.print_logs();
```

#### Account Lookup

```rust
let acct: Option<&Account> = result.account(&pubkey);
```

## Account Types

### Account

The universal account type:

```rust
pub struct Account {
    pub address: Pubkey,
    pub lamports: u64,
    pub data: Vec<u8>,
    pub owner: Pubkey,
    pub executable: bool,
}
```

### Account Factories

All factories return `Account` with the address as the first parameter.

#### System Account

Create a system-owned account with a SOL balance:

```rust
use quasar_svm::token::create_keyed_system_account;

let account = create_keyed_system_account(&pubkey, 1_000_000_000);
```

#### Mint Account

Create a pre-initialized SPL Token mint:

```rust
use quasar_svm::token::{create_keyed_mint_account, create_keyed_mint_account_with_program, Mint};

// Uses SPL_TOKEN_PROGRAM_ID by default
let account = create_keyed_mint_account(
    &pubkey,
    &Mint { decimals: 6, ..Default::default() },
);

// Token-2022
let account = create_keyed_mint_account_with_program(
    &pubkey,
    &Mint { decimals: 6, ..Default::default() },
    &SPL_TOKEN_2022_PROGRAM_ID,
);
```

#### Token Account

Create a pre-initialized token account:

```rust
use quasar_svm::token::{create_keyed_token_account, create_keyed_token_account_with_program, TokenAccount};

// Uses SPL_TOKEN_PROGRAM_ID by default
let account = create_keyed_token_account(
    &pubkey,
    &TokenAccount { mint, owner, amount: 5_000, ..Default::default() },
);

// Token-2022
let account = create_keyed_token_account_with_program(
    &pubkey,
    &TokenAccount { mint, owner, amount: 5_000, ..Default::default() },
    &SPL_TOKEN_2022_PROGRAM_ID,
);
```

#### Associated Token Account

Derive the ATA address automatically and create a pre-initialized token account:

```rust
use quasar_svm::token::{create_keyed_associated_token_account, create_keyed_associated_token_account_with_program};

// Uses SPL_TOKEN_PROGRAM_ID by default
let account = create_keyed_associated_token_account(&wallet, &mint, 5_000);
// account.address is the derived ATA address

// Token-2022
let account = create_keyed_associated_token_account_with_program(&wallet, &mint, 5_000, &SPL_TOKEN_2022_PROGRAM_ID);
```

## Token Types

### Mint

```rust
pub struct Mint {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub freeze_authority: Option<Pubkey>,
}

let mint = Mint::default(); // decimals = 9, supply = 0, no authorities
let mint = Mint { decimals: 6, supply: 10_000, ..Default::default() };
```

### TokenAccount

```rust
// Re-exported from spl_token::state
pub struct TokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub delegate: Option<Pubkey>,
    pub state: AccountState,
    pub is_native: Option<u64>,
    pub delegated_amount: u64,
    pub close_authority: Option<Pubkey>,
}

let token = TokenAccount { mint, owner, amount: 5_000, state: AccountState::Initialized, ..Default::default() };
```

### AccountState

```rust
// From spl_token::state::AccountState
pub enum AccountState {
    Uninitialized = 0,
    Initialized  = 1, // default
    Frozen       = 2,
}
```

## Token Instructions

Use the `spl_token` crate directly to create instructions:

```rust
use spl_token::instruction;

// Transfer
let ix = instruction::transfer(
    &SPL_TOKEN_PROGRAM_ID,
    &source,
    &destination,
    &authority,
    &[],
    1_000,
).unwrap();

// MintTo
let ix = instruction::mint_to(
    &SPL_TOKEN_PROGRAM_ID,
    &mint,
    &destination,
    &mint_authority,
    &[],
    5_000,
).unwrap();

// Burn
let ix = instruction::burn(
    &SPL_TOKEN_PROGRAM_ID,
    &source,
    &mint,
    &authority,
    &[],
    500,
).unwrap();
```

## Reading Token Account Data

Use `spl_token::state` to unpack account data from execution results:

```rust
use spl_token::state::{Account as SplTokenAccount, Mint as SplMint};
use solana_program_pack::Pack;

let bob_account = result.account(&bob_address).unwrap();
let bob_token = SplTokenAccount::unpack(&bob_account.data).unwrap();
assert_eq!(bob_token.amount, 1_000);

let mint_account = result.account(&mint_address).unwrap();
let mint = SplMint::unpack(&mint_account.data).unwrap();
assert_eq!(mint.supply, 15_000);
```

## Token-2022 Support

All factories that create token-related accounts have `_with_program` variants. Use `SPL_TOKEN_2022_PROGRAM_ID` to create Token-2022 accounts:

```rust
use quasar_svm::SPL_TOKEN_2022_PROGRAM_ID;

let mint = create_keyed_mint_account_with_program(&mint_addr, &mint_opts, &SPL_TOKEN_2022_PROGRAM_ID);
let token = create_keyed_token_account_with_program(&token_addr, &token_opts, &SPL_TOKEN_2022_PROGRAM_ID);
let ata = create_keyed_associated_token_account_with_program(&wallet, &mint_addr, amount, &SPL_TOKEN_2022_PROGRAM_ID);
```

## Built-in Programs

The system program, BPF Loader v2, and Upgradeable Loader v3 are always available. SPL programs are bundled and loaded on demand.

## Full Example

```rust
use quasar_svm::{QuasarSvm, Pubkey, SPL_TOKEN_PROGRAM_ID};
use quasar_svm::token::*;
use spl_token::state::Account as SplTokenAccount;
use solana_program_pack::Pack;

let authority = Pubkey::new_unique();
let recipient = Pubkey::new_unique();

let mint  = create_keyed_mint_account(
    &Pubkey::new_unique(),
    &Mint { decimals: 6, supply: 10_000, ..Default::default() },
);
let alice = create_keyed_associated_token_account(&authority, &mint.address, 5_000);
let bob   = create_keyed_associated_token_account(&recipient, &mint.address, 0);

let ix = spl_token::instruction::transfer(
    &SPL_TOKEN_PROGRAM_ID,
    &alice.address,
    &bob.address,
    &authority,
    &[],
    1_000,
).unwrap();

let mut svm = QuasarSvm::new(); // Token program loaded by default

let result = svm.process_instruction(&ix, &[mint, alice, bob]);

result.assert_success();

// Verify by unpacking account data
let bob_account = result.account(&bob.address).unwrap();
let bob_token = SplTokenAccount::unpack(&bob_account.data).unwrap();
assert_eq!(bob_token.amount, 1_000);

let alice_account = result.account(&alice.address).unwrap();
let alice_token = SplTokenAccount::unpack(&alice_account.data).unwrap();
assert_eq!(alice_token.amount, 4_000);
```

## Workspace

| Crate | Path | Purpose |
|-------|------|---------|
| `quasar-svm` | `svm/` | Core execution engine — `QuasarSvm`, `ExecutionResult`, `Account`, token helpers |
| `quasar-svm-ffi` | `ffi/` | C-ABI wrapper for Node.js FFI via koffi |
| TypeScript bindings | `bindings/node/` | `web3.js` and `kit` API layers over the native engine |
