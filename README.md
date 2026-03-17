<h1 align="center">
  <code>quasar-svm</code>
</h1>
<p align="center">
  In-process Solana execution for Rust and Node.js.
</p>

## Overview

QuasarSVM is a lightweight Solana virtual machine that executes transactions locally without an RPC connection or validator. Provide program ELFs, account state, and instructions — get back logs, compute units, return data, byte-level account diffs, and resulting accounts.

`Account` is the universal account type across all layers.

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

let authority = Pubkey::new_unique();

let mint = create_mint_account(&Mint { decimals: 6, supply: 10_000, ..Default::default() }, &SPL_TOKEN_PROGRAM_ID);
let alice = create_associated_token_account(&authority, &mint.address, 5_000, &SPL_TOKEN_PROGRAM_ID);
let bob   = create_associated_token_account(&Pubkey::new_unique(), &mint.address, 0, &SPL_TOKEN_PROGRAM_ID);

let ix = token_transfer(&alice.address, &bob.address, &authority, 1_000, &SPL_TOKEN_PROGRAM_ID);

let mut svm = QuasarSvm::new().with_token_program();

let result = svm.process_instruction(&ix, &[mint, alice, bob]);

result.assert_success();
assert_eq!(result.token_balance(&bob.address), Some(1_000));
```

### TypeScript (web3.js)

```ts
import {
  QuasarSvm,
  createMintAccount, createAssociatedTokenAccount,
  tokenTransfer,
} from "@blueshift-gg/quasar-svm/web3.js";
import { Keypair } from "@solana/web3.js";

const vm = new QuasarSvm().addTokenProgram();

const authority = Keypair.generate().publicKey;

const mint  = createMintAccount({ decimals: 6, supply: 10_000n });
const alice = createAssociatedTokenAccount(authority, mint.address, 5_000n);
const bob   = createAssociatedTokenAccount(Keypair.generate().publicKey, mint.address, 0n);

const ix = tokenTransfer(alice.address, bob.address, authority, 1_000n);

const result = vm.processInstruction(ix, [mint, alice, bob]);

result.assertSuccess();
console.log(result.tokenBalance(bob.address)); // 1000n
```

### TypeScript (kit)

```ts
import {
  QuasarSvm,
  createMintAccount, createAssociatedTokenAccount,
  tokenTransfer,
} from "@blueshift-gg/quasar-svm/kit";
import { generateKeyPair, getAddressFromPublicKey } from "@solana/keys";

const vm = new QuasarSvm().addTokenProgram();

const authorityKp = await generateKeyPair();
const authority = await getAddressFromPublicKey(authorityKp.publicKey);

const mint  = createMintAccount({ decimals: 6, supply: 10_000n });
const alice = await createAssociatedTokenAccount(authority, mint.address, 5_000n);
const bob   = await createAssociatedTokenAccount(
  await getAddressFromPublicKey((await generateKeyPair()).publicKey),
  mint.address, 0n,
);

const ix = tokenTransfer(alice.address, bob.address, authority, 1_000n);

const result = vm.processInstruction(ix, [mint, alice, bob]);

result.assertSuccess();
console.log(result.tokenBalance(bob.address)); // 1000n
```

> Native memory is freed automatically by the GC. For deterministic cleanup in tight loops, use `using vm = new QuasarSvm()` or call `vm.free()`.

## Documentation

| Document | Content |
|----------|---------|
| [Core API](docs/api.md) | `QuasarSvm` — programs, execution, sysvars, `ExecutionResult` |
| [Accounts](docs/accounts.md) | Account types, account factories, optional address pattern, interop helpers |
| [Tokens](docs/tokens.md) | Mint/Token types, instruction builders, result helpers, ATA derivation |

## Exports

| Import Path | Address Type | Account Type | Description |
|-------------|-------------|--------------|-------------|
| `@blueshift-gg/quasar-svm/web3.js` | `PublicKey` | `KeyedAccount` | `@solana/web3.js` API |
| `@blueshift-gg/quasar-svm/kit` | `Address` | `Account` | `@solana/kit` API |
| `@blueshift-gg/quasar-svm/ffi` | — | — | Low-level native bindings |

Both TypeScript APIs expose the same functionality with different address types. The web3.js layer uses `KeyedAccount` and the kit layer uses `Account`. The web3.js layer additionally provides `toKeyedAccountInfo` / `fromKeyedAccountInfo` for interop with legacy code.

## Workspace

| Crate | Path | Purpose |
|-------|------|---------|
| `quasar-svm` | `svm/` | Core execution engine — `QuasarSvm`, `ExecutionResult`, `Account`, token helpers |
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

```ts
new QuasarSvm()
  .addTokenProgram()
  .addToken2022Program()
  .addAssociatedTokenProgram();
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
