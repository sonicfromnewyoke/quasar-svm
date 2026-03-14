# QuasarSvm

Lightweight Solana VM execution for Node.js.

`quasar-svm` runs Solana instructions locally using a native Rust engine. It is designed for simulation-style workflows where you provide program binaries, instructions, and account state, then inspect logs, return data, compute usage, and resulting accounts.

## What it does

- Executes Solana instructions and transactions off-chain
- Loads custom program ELFs
- Supports bundled SPL Token, Token-2022, and Associated Token Account programs
- Exposes both `@solana/web3.js` and Solana Kit-style APIs
- Returns logs, return data, compute units, execution time, and updated accounts

## Install

```bash
npm install @blueshift-gg/quasar-svm
```

Platform-specific native binaries are installed automatically through optional dependencies.

## Exports

- `@blueshift-gg/quasar-svm/web3.js` - `@solana/web3.js` API
- `@blueshift-gg/quasar-svm/kit` - `@solana/addresses` / `@solana/instructions` API
- `@blueshift-gg/quasar-svm/ffi` - low-level native bindings

Seed token state on the VM with `addMintAccount(...)` and `addTokenAccount(...)`, then pass only the runtime signer accounts into execution.

## Example: `@solana/web3.js`

```ts
import {
  QuasarSvm,
  tokenTransfer,
  tokenAccount,
  assertSuccess,
} from "@blueshift-gg/quasar-svm/web3.js";
import { KeyedAccountInfo, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

const vm = new QuasarSvm().addTokenProgram();

const mint = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const source = Keypair.generate().publicKey;
const destination = Keypair.generate().publicKey;

vm.addMintAccount(mint, {
  mintAuthority: owner,
  supply: 5_000n,
  decimals: 6,
});

vm.addTokenAccount(source, {
  mint,
  owner,
  amount: 5_000n,
});

vm.addTokenAccount(destination, {
  mint,
  owner,
  amount: 0n,
});

const accounts = [
  {
    accountId: owner,
    accountInfo: {
      owner: SystemProgram.programId,
      lamports: 1_000_000_000n,
      executable: false,
      data: new Uint8Array(),
      rentEpoch: 0n,
    },
  } as KeyedAccountInfo,
];

const instruction = tokenTransfer(source, destination, owner, 1_000n);

const result = vm.processInstruction(instruction, accounts);

assertSuccess(result);
console.log(tokenAccount(result, destination)?.amount);

vm.free();
```

## Example: Solana Kit

```ts
import {
  QuasarSvm,
  tokenTransfer,
  tokenAccount,
  assertSuccess,
  type SvmAccount,
} from "@blueshift-gg/quasar-svm/kit";
import { address, createNoopSigner } from "@solana/kit";

const vm = new QuasarSvm().addTokenProgram();

const mint = address("11111111111111111111111111111114");
const owner = createNoopSigner(address("11111111111111111111111111111115"));
const source = address("11111111111111111111111111111112");
const destination = address("11111111111111111111111111111113");
const systemProgram = address("11111111111111111111111111111111");
vm.addMintAccount(mint, {
  mintAuthority: owner.address,
  supply: 5_000n,
  decimals: 6,
});

vm.addTokenAccount(source, {
  mint,
  owner: owner.address,
  amount: 5_000n,
});

vm.addTokenAccount(destination, {
  mint,
  owner: owner.address,
  amount: 0n,
});

const accounts: Account<Uint8Array>[] = [
  {
    address: owner.address,
    programAddress: systemProgram,
    lamports: 1_000_000_000n,
    executable: false,
    data: new Uint8Array(),
    space: 0n,
  },
];

const instruction = tokenTransfer(source, destination, owner.address, 1_000n);

const result = vm.processInstruction(instruction, accounts);

assertSuccess(result);
console.log(tokenAccount(result, destination)?.amount);

vm.free();
```

## Core API

- `new QuasarSvm()` - create a VM instance
- `addProgram(programId, elf, loaderVersion?)` - register a program
- `addTokenProgram()` / `addToken2022Program()` / `addAssociatedTokenProgram()` - load bundled programs
- `setClock(...)`, `warpToSlot(...)`, `setRent(...)`, `setEpochSchedule(...)`, `setComputeBudget(...)` - configure runtime state
- `processInstruction(...)` - execute one or more instructions with persisted account state
- `processTransaction(...)` - execute instructions atomically as one transaction
- `free()` - release native resources

## Notes

- This is a local execution engine, not an RPC client or validator
- You must provide the instructions, accounts, and any non-builtin program ELFs you want to execute
- Built in by default: system program, BPF loader v2, and upgradeable loader v3

## Development

```bash
npm run build
npm run build:native
```

## License

MIT
