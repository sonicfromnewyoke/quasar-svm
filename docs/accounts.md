# Accounts

QuasarSVM uses standalone account factory functions to create test account state. Accounts are created externally and passed to execution — they are not stored inside the VM.

## Account Factories

All factories support both SPL Token and Token-2022 via the `tokenProgramId` parameter.

### System Account

Create a system-owned account with a SOL balance:

```rust
use quasar_svm::token::create_system_account;

let account = create_system_account(1_000_000_000); // 1 SOL
```

```ts
// web3.js
import { createSystemAccount } from "@blueshift-gg/quasar-svm/web3.js";

const account = createSystemAccount(pubkey, 1_000_000_000n);
// account.accountId: PublicKey, account.accountInfo: AccountInfo<Buffer>

// kit
import { createSystemAccount } from "@blueshift-gg/quasar-svm/kit";

const account = createSystemAccount(addr, 1_000_000_000n);
// account.address: Address, account.programAddress: Address
```

### Mint Account

Create a pre-initialized SPL Token mint:

```rust
use quasar_svm::token::{create_mint_account, Mint};

let account = create_mint_account(
    &Mint { mint_authority: Some(authority), supply: 0, decimals: 6, freeze_authority: None },
    &SPL_TOKEN_PROGRAM_ID,
);

// Token-2022
let account = create_mint_account(&mint, &SPL_TOKEN_2022_PROGRAM_ID);
```

```ts
// web3.js
const account = createMintAccount(pubkey, { mintAuthority: authority, decimals: 6 });

// Token-2022
const account = createMintAccount(pubkey, { decimals: 6 }, new PublicKey(SPL_TOKEN_2022_PROGRAM_ID));

// kit
import { createMintAccount } from "@blueshift-gg/quasar-svm/kit";

const account = createMintAccount(addr, { mintAuthority: authority, decimals: 6 });
const account = createMintAccount(addr, { decimals: 6 }, address(SPL_TOKEN_2022_PROGRAM_ID));
```

### Token Account

Create a pre-initialized token account at a specific address:

```rust
use quasar_svm::token::{create_token_account, Token};

let account = create_token_account(
    &Token { mint, owner, amount: 5_000, ..Default::default() },
    &SPL_TOKEN_PROGRAM_ID,
);
```

```ts
// web3.js
const account = createTokenAccount(pubkey, { mint, owner, amount: 5_000n });

// kit
const account = createTokenAccount(addr, { mint, owner, amount: 5_000n });
```

### Associated Token Account

Derive the ATA address automatically and create a pre-initialized token account:

```rust
use quasar_svm::token::create_associated_token_account;

let (ata_pubkey, account) = create_associated_token_account(
    &wallet, &mint, 5_000, &SPL_TOKEN_PROGRAM_ID,
);
```

```ts
// web3.js (sync)
const account = createAssociatedTokenAccount(owner, mint, 5_000n);
account.accountId; // derived ATA address

// kit (async — PDA derivation is async in @solana/addresses)
const account = await createAssociatedTokenAccount(owner, mint, 5_000n);
account.address; // derived ATA address
```

## User

The `User` class bundles a system account and optional token positions into a single test entity. It auto-generates a keypair, derives ATAs, and flattens everything for execution.

### Creating Users

```rust
use quasar_svm::user::{User, UserToken};

let alice = User::new(1_000_000_000, &[
    UserToken::spl(&mint, 5_000),
    UserToken::spl(&other_mint, 100),
]);

// Token-2022
let bob = User::new(1_000_000_000, &[
    UserToken::spl_2022(&mint_2022, 10_000),
]);

// SOL only
let charlie = User::new(1_000_000_000, &[]);
```

```ts
// web3.js — mint: PublicKey, tokenProgramId: PublicKey
const alice = await User.create(1_000_000_000n, [
  { mint, amount: 5_000n },
  { mint: otherMint, amount: 100n },
]);

// Token-2022
const bob = await User.create(1_000_000_000n, [
  { mint: mint2022, amount: 10_000n, tokenProgramId: new PublicKey(SPL_TOKEN_2022_PROGRAM_ID) },
]);

// SOL only
const charlie = await User.create(1_000_000_000n);
```

```ts
// kit — mint: Address, tokenProgramId: Address
import { User } from "@blueshift-gg/quasar-svm/kit";

const alice = await User.create(1_000_000_000n, [
  { mint, amount: 5_000n },
  { mint: otherMint, amount: 100n },
]);

// Token-2022
const bob = await User.create(1_000_000_000n, [
  { mint: mint2022, amount: 10_000n, tokenProgramId: address(SPL_TOKEN_2022_PROGRAM_ID) },
]);
```

### Using Users

```rust
alice.pubkey          // the user's public key
alice.ata(&mint)      // derived ATA address for a mint
alice.accounts()      // Vec<(Pubkey, Account)> — system + all token accounts
```

```ts
// web3.js
alice.pubkey          // PublicKey
alice.ata(mint)       // PublicKey — derived ATA address
alice.accounts()      // KeyedAccountInfo[]

// kit
alice.pubkey          // Address
alice.ata(mint)       // Address — derived ATA address
alice.accounts()      // SvmAccount[]
```

### Passing to Execution

Flatten user accounts with spread or concat:

```rust
let result = svm.process_instructions(
    &[ix],
    &[alice.accounts(), bob.accounts()].concat(),
);
```

```ts
const result = vm.processInstruction(ix, [
  ...alice.accounts(),
  ...bob.accounts(),
]);
```

## Named Account Maps

`processInstruction`, `processTransaction`, and `simulateTransaction` accept either an array or a `Record<string, Account>`. This enables typed account maps from codegen:

```ts
// Array (always works)
vm.processInstruction(ix, [acct1, acct2, acct3]);

// Named map
vm.processInstruction(ix, {
  source: sourceAccount,
  destination: destAccount,
  owner: ownerAccount,
});
```

### Codegen Integration

When Quasar's IDL generates both instruction builders and account types, the test harness writes itself:

**web3.js:**

```ts
// Generated by quasar idl
interface MakeAccounts {
  maker: KeyedAccountInfo;
  escrow: KeyedAccountInfo;
  mintA: KeyedAccountInfo;
  vaultA: KeyedAccountInfo;
  systemProgram: KeyedAccountInfo;
}

// Test code
const accounts: MakeAccounts = {
  maker: alice.accounts()[0],
  escrow: createSystemAccount(escrowPubkey, 0n),
  mintA: createMintAccount(mintPubkey, { decimals: 6 }),
  vaultA: createAssociatedTokenAccount(escrowPubkey, mintPubkey, 0n),
  systemProgram: createSystemAccount(SystemProgram.programId, 0n),
};

vm.processInstruction(makeIx, accounts);
```

**kit:**

```ts
// Generated by quasar idl
interface MakeAccounts {
  maker: SvmAccount;
  escrow: SvmAccount;
  mintA: SvmAccount;
  vaultA: SvmAccount;
  systemProgram: SvmAccount;
}

// Test code
const accounts: MakeAccounts = {
  maker: alice.accounts()[0],
  escrow: createSystemAccount(escrowAddr, 0n),
  mintA: createMintAccount(mintAddr, { decimals: 6 }),
  vaultA: await createAssociatedTokenAccount(escrowAddr, mintAddr, 0n),
  systemProgram: createSystemAccount(address(SYSTEM_PROGRAM_ID), 0n),
};

vm.processInstruction(makeIx, accounts);
```

### Instruction Chaining

Spread multiple account maps together when chaining instructions:

```ts
vm.processInstruction(
  [createAtaIx, transferIx],
  { ...createAtaAccounts, ...transferAccounts },
);
```

When keys collide (e.g., both have `mint`), the last spread wins. This is correct when both reference the same account.

## MintOpts / TokenAccountOpts

Full interfaces for advanced account configuration:

**web3.js:**

```ts
interface MintOpts {
  mintAuthority?: PublicKey;
  supply?: bigint;
  decimals?: number;
  freezeAuthority?: PublicKey;
}

interface TokenAccountOpts {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate?: PublicKey;
  state?: TokenAccountState;       // Uninitialized | Initialized | Frozen
  isNative?: bigint;
  delegatedAmount?: bigint;
  closeAuthority?: PublicKey;
}
```

**kit:**

```ts
interface MintOpts {
  mintAuthority?: Address;
  supply?: bigint;
  decimals?: number;
  freezeAuthority?: Address;
}

interface TokenAccountOpts {
  mint: Address;
  owner: Address;
  amount: bigint;
  delegate?: Address;
  state?: TokenAccountState;
  isNative?: bigint;
  delegatedAmount?: bigint;
  closeAuthority?: Address;
}
```

Rust equivalents use `Mint` and `Token` structs with the same fields:

```rust
pub struct Mint {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub freeze_authority: Option<Pubkey>,
}

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
```
