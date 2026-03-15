<h1 align="center">
  <code>quasar-svm</code>
</h1>
<p align="center">
  In-process Solana execution for Rust and Node.js.
</p>

## Overview

QuasarSVM is a lightweight Solana virtual machine that executes instructions locally without an RPC connection or validator. Provide program ELFs, account state, and instructions — get back logs, compute units, return data, and resulting accounts.

```toml
[dependencies]
quasar-svm = "0.1"
```

```bash
npm install @blueshift-gg/quasar-svm
```

## Quick Start

### Rust

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
```

### TypeScript (web3.js)

```ts
import {
  QuasarSvm, User,
  createMintAccount, tokenTransfer, tokenAccount, assertSuccess,
} from "@blueshift-gg/quasar-svm/web3.js";
import { Keypair } from "@solana/web3.js";

const vm = new QuasarSvm().addTokenProgram();

const mint = (await Keypair.generate()).publicKey;
const mintAcct = createMintAccount(mint, { decimals: 6 });

const alice = await User.create(1_000_000_000n, [{ mint, amount: 5_000n }]);
const bob   = await User.create(1_000_000_000n, [{ mint, amount: 0n }]);

const ix = tokenTransfer(alice.ata(mint), bob.ata(mint), alice.pubkey, 1_000n);

const result = vm.processInstruction(ix, [mintAcct, ...alice.accounts(), ...bob.accounts()]);

assertSuccess(result);
console.log(tokenAccount(result, bob.ata(mint))?.amount); // 1000n

vm.free();
```

## Documentation

| Document | Content |
|----------|---------|
| [Core API](docs/api.md) | `QuasarSvm` — programs, execution, sysvars, snapshots, account store |
| [Accounts](docs/accounts.md) | Account factories, `User` abstraction, named account maps |
| [Tokens](docs/tokens.md) | Mint/Token types, instruction builders, result unpacking, ATA derivation |

## Exports

| Import Path | Types | Description |
|-------------|-------|-------------|
| `@blueshift-gg/quasar-svm/web3.js` | `PublicKey`, `KeyedAccountInfo` | `@solana/web3.js` API |
| `@blueshift-gg/quasar-svm/kit` | `Address`, `SvmAccount` | `@solana/addresses` / `@solana/instructions` API |
| `@blueshift-gg/quasar-svm/ffi` | — | Low-level native bindings |

Both TypeScript APIs expose the same functionality with different type systems. The web3.js API uses `PublicKey` and `KeyedAccountInfo`; the kit API uses `Address` and `SvmAccount`.

## Workspace

| Crate | Path | Purpose |
|-------|------|---------|
| `quasar-svm` | `svm/` | Core execution engine — `QuasarSvm`, `ExecutionResult`, token helpers, `User` |
| `quasar-svm-ffi` | `ffi/` | C-ABI wrapper for Node.js FFI via koffi |
| TypeScript bindings | `bindings/node/` | `web3.js` and `kit` API layers over the native engine |

## Built-in Programs

The system program, BPF Loader v2, and Upgradeable Loader v3 are always available. SPL programs are bundled and loaded on demand:

```rust
QuasarSvm::new()
    .with_token_program()           // SPL Token
    .with_token_2022_program()      // Token-2022
    .with_associated_token_program() // Associated Token Account
```

## Development

```bash
# Rust
cargo check --workspace
cargo clippy --workspace

# TypeScript
npm run build
npm run build:native
```

## License

MIT
