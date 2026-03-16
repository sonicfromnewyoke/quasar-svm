# Tokens

QuasarSVM includes built-in SPL Token types, instruction builders, and result helpers. Everything works with both SPL Token and Token-2022.

## Types

### Mint

The `Mint` struct/interface represents SPL Token mint state.

**Rust:**

```rust
pub struct Mint {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub freeze_authority: Option<Pubkey>,
}

// Default: decimals = 9, supply = 0, no authorities
let mint = Mint::default();
let mint = Mint { decimals: 6, supply: 10_000, ..Default::default() };
```

**TypeScript (web3.js):**

```ts
interface MintOpts {
  mintAuthority?: PublicKey;
  supply?: bigint;
  decimals?: number;         // default: 9
  freezeAuthority?: PublicKey;
}

createMintAccount(pubkey, { decimals: 6, supply: 10_000n });
createMintAccount(pubkey, {}); // defaults: decimals 9, supply 0
```

**TypeScript (kit):**

```ts
interface MintOpts {
  mintAuthority?: Address;
  supply?: bigint;
  decimals?: number;
  freezeAuthority?: Address;
}

createMintAccount(addr, { decimals: 6, supply: 10_000n });
```

### Token

The `Token` struct/interface represents SPL Token account state.

**Rust:**

```rust
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

// Default: state = Initialized, amount = 0
let token = Token { mint, owner, amount: 5_000, ..Default::default() };
```

**TypeScript (web3.js):**

```ts
interface TokenAccountOpts {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate?: PublicKey;
  state?: TokenAccountState; // default: Initialized
  isNative?: bigint;
  delegatedAmount?: bigint;
  closeAuthority?: PublicKey;
}
```

**TypeScript (kit):**

```ts
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

### TokenAccountState

```rust
pub enum TokenAccountState {
    Uninitialized = 0,
    Initialized  = 1, // default
    Frozen       = 2,
}
```

```ts
enum TokenAccountState {
  Uninitialized = 0,
  Initialized   = 1, // default
  Frozen        = 2,
}
```

## Instruction Builders

All builders accept a `tokenProgramId` parameter (defaults to SPL Token). Pass `SPL_TOKEN_2022_PROGRAM_ID` for Token-2022.

### Transfer

```rust
use quasar_svm::token::token_transfer;

let ix = token_transfer(&source, &destination, &authority, 1_000, &SPL_TOKEN_PROGRAM_ID);

// Token-2022
let ix = token_transfer(&source, &destination, &authority, 1_000, &SPL_TOKEN_2022_PROGRAM_ID);
```

```ts
// web3.js — args are PublicKey, returns TransactionInstruction
import { tokenTransfer } from "@blueshift-gg/quasar-svm/web3.js";

const ix = tokenTransfer(source, destination, authority, 1_000n);

// Token-2022
const ix = tokenTransfer(source, destination, authority, 1_000n, new PublicKey(SPL_TOKEN_2022_PROGRAM_ID));
```

```ts
// kit — args are Address, returns Instruction
import { tokenTransfer } from "@blueshift-gg/quasar-svm/kit";

const ix = tokenTransfer(source, destination, authority, 1_000n);

// Token-2022
const ix = tokenTransfer(source, destination, authority, 1_000n, address(SPL_TOKEN_2022_PROGRAM_ID));
```

### MintTo

```rust
use quasar_svm::token::token_mint_to;

let ix = token_mint_to(&mint, &destination, &mint_authority, 5_000, &SPL_TOKEN_PROGRAM_ID);
```

```ts
// web3.js
import { tokenMintTo } from "@blueshift-gg/quasar-svm/web3.js";

const ix = tokenMintTo(mint, destination, mintAuthority, 5_000n);

// kit
import { tokenMintTo } from "@blueshift-gg/quasar-svm/kit";

const ix = tokenMintTo(mint, destination, mintAuthority, 5_000n);
```

### Burn

```rust
use quasar_svm::token::token_burn;

let ix = token_burn(&source, &mint, &authority, 500, &SPL_TOKEN_PROGRAM_ID);
```

```ts
// web3.js
import { tokenBurn } from "@blueshift-gg/quasar-svm/web3.js";

const ix = tokenBurn(source, mint, authority, 500n);

// kit
import { tokenBurn } from "@blueshift-gg/quasar-svm/kit";

const ix = tokenBurn(source, mint, authority, 500n);
```

## Result Unpacking

After execution, unpack token and mint state from the resulting accounts.

### Token Account

```rust
let result = svm.process_instructions(&[ix], &accounts);
let token = result.token_account(&ata_pubkey).unwrap();
assert_eq!(token.amount, 1_000);
assert_eq!(token.owner, alice.pubkey);
```

```ts
// web3.js
import { tokenAccount } from "@blueshift-gg/quasar-svm/web3.js";

const result = vm.processInstruction(ix, accounts);
const token = tokenAccount(result, ataPubkey);
console.log(token?.amount);  // 1000n
console.log(token?.owner);   // Uint8Array (32 bytes)

// kit
import { tokenAccount } from "@blueshift-gg/quasar-svm/kit";

const token = tokenAccount(result, ataAddress);
console.log(token?.amount);  // 1000n
```

### Mint Account

```rust
let mint_state = result.mint_account(&mint_pubkey).unwrap();
assert_eq!(mint_state.supply, 15_000);
assert_eq!(mint_state.decimals, 6);
```

```ts
// web3.js
import { mintAccount } from "@blueshift-gg/quasar-svm/web3.js";

const mint = mintAccount(result, mintPubkey);
console.log(mint?.supply);   // 15000n
console.log(mint?.decimals); // 6

// kit
import { mintAccount } from "@blueshift-gg/quasar-svm/kit";

const mint = mintAccount(result, mintAddress);
console.log(mint?.supply);   // 15000n
```

## ATA Derivation

Derive associated token account addresses without creating accounts.

```rust
use quasar_svm::token::get_associated_token_address;

let ata = get_associated_token_address(&wallet, &mint, &SPL_TOKEN_PROGRAM_ID);

// Token-2022
let ata = get_associated_token_address(&wallet, &mint, &SPL_TOKEN_2022_PROGRAM_ID);
```

```ts
// web3.js (sync)
import { PublicKey } from "@solana/web3.js";

const [ata] = PublicKey.findProgramAddressSync(
  [wallet.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
  new PublicKey(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
);

// kit (async)
import { getProgramDerivedAddress } from "@solana/addresses";

const [ata] = await getProgramDerivedAddress({
  programAddress: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  seeds: [encode(wallet), encode(tokenProgramId), encode(mint)],
});
```

Or use the `User` class which handles derivation automatically:

```rust
let alice = User::new(1_000_000_000, &[UserToken::spl(&mint, 5_000)]);
alice.ata(&mint) // derived ATA address
```

```ts
const alice = await User.create(1_000_000_000n, [{ mint, amount: 5_000n }]);
alice.ata(mint) // derived ATA address
```

## Full Example

```rust
use quasar_svm::{QuasarSvm, Pubkey, SPL_TOKEN_PROGRAM_ID};
use quasar_svm::token::*;
use quasar_svm::user::{User, UserToken};

let mint = Pubkey::new_unique();
let mint_account = create_mint_account(
    &Mint { mint_authority: None, supply: 10_000, decimals: 6, freeze_authority: None },
    &SPL_TOKEN_PROGRAM_ID,
);

let alice = User::new(1_000_000_000, &[UserToken::spl(&mint, 5_000)]);
let bob   = User::new(1_000_000_000, &[UserToken::spl(&mint, 0)]);

let ix = token_transfer(
    &alice.ata(&mint), &bob.ata(&mint), &alice.pubkey, 1_000, &SPL_TOKEN_PROGRAM_ID,
);

let mut svm = QuasarSvm::new().with_token_program();

let result = svm.process_instructions(
    &[ix],
    &[(mint, mint_account), alice.accounts(), bob.accounts()].concat(),
);

result.assert_success();
assert_eq!(result.token_account(&bob.ata(&mint)).unwrap().amount, 1_000);
assert_eq!(result.token_account(&alice.ata(&mint)).unwrap().amount, 4_000);
```

**web3.js:**

```ts
import {
  QuasarSvm, User,
  createMintAccount, tokenTransfer, tokenAccount, assertSuccess,
} from "@blueshift-gg/quasar-svm/web3.js";
import { Keypair } from "@solana/web3.js";

const vm = new QuasarSvm().addTokenProgram();

const mint = (await Keypair.generate()).publicKey;
const mintAcct = createMintAccount(mint, { decimals: 6, supply: 10_000n });

const alice = await User.create(1_000_000_000n, [{ mint, amount: 5_000n }]);
const bob   = await User.create(1_000_000_000n, [{ mint, amount: 0n }]);

const ix = tokenTransfer(alice.ata(mint), bob.ata(mint), alice.pubkey, 1_000n);

const result = vm.processInstruction(ix, [mintAcct, ...alice.accounts(), ...bob.accounts()]);

assertSuccess(result);
console.log(tokenAccount(result, bob.ata(mint))?.amount);   // 1000n
console.log(tokenAccount(result, alice.ata(mint))?.amount); // 4000n

vm.free();
```

**kit:**

```ts
import {
  QuasarSvm, User,
  createMintAccount, tokenTransfer, tokenAccount, assertSuccess,
} from "@blueshift-gg/quasar-svm/kit";
import { generateKeyPair, getAddressFromPublicKey } from "@solana/keys";

const vm = new QuasarSvm().addTokenProgram();

const mintKp = await generateKeyPair();
const mint = await getAddressFromPublicKey(mintKp.publicKey);
const mintAcct = createMintAccount(mint, { decimals: 6, supply: 10_000n });

const alice = await User.create(1_000_000_000n, [{ mint, amount: 5_000n }]);
const bob   = await User.create(1_000_000_000n, [{ mint, amount: 0n }]);

const ix = tokenTransfer(alice.ata(mint), bob.ata(mint), alice.pubkey, 1_000n);

const result = vm.processInstruction(ix, [mintAcct, ...alice.accounts(), ...bob.accounts()]);

assertSuccess(result);
console.log(tokenAccount(result, bob.ata(mint))?.amount);   // 1000n
console.log(tokenAccount(result, alice.ata(mint))?.amount); // 4000n

vm.free();
```
