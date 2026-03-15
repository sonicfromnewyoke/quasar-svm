# Core API

QuasarSVM provides an in-process Solana execution engine. Create a `QuasarSvm` instance, load programs, configure sysvars, and execute instructions.

## QuasarSvm

### Creating a VM

```rust
let svm = QuasarSvm::new();
```

```ts
const vm = new QuasarSvm();
```

### Loading Programs

Load a custom program from an ELF binary:

```rust
let elf = std::fs::read("target/deploy/my_program.so").unwrap();
svm.add_program(&program_id, &loader_keys::LOADER_V3, &elf);

// Builder-style
let svm = QuasarSvm::new()
    .with_program(&program_id, &elf)
    .with_program_loader(&program_id, &loader_keys::LOADER_V2, &elf);
```

```ts
vm.addProgram(programId, elf);             // loader v3 (default)
vm.addProgram(programId, elf, LOADER_V2);  // loader v2
```

Load bundled SPL programs:

```rust
let svm = QuasarSvm::new()
    .with_token_program()
    .with_token_2022_program()
    .with_associated_token_program();
```

```ts
const vm = new QuasarSvm()
  .addTokenProgram()
  .addToken2022Program()
  .addAssociatedTokenProgram();
```

`addSystemProgram()` / `with_system_program()` are no-ops — the system program is always available.

### Executing Instructions

Three execution modes:

| Method | Behavior |
|--------|----------|
| `process_instructions` / `processInstruction` | Execute instructions sequentially. State persists between instructions. Non-atomic. |
| `process_transaction` / `processTransaction` | Execute all instructions as one atomic transaction. State rolls back on failure. |
| `simulate_transaction` / `simulateTransaction` | Execute without committing any state changes. |

**Rust:**

```rust
let result = svm.process_instructions(&[ix], &accounts);
let result = svm.process_transaction(&[ix1, ix2], &accounts);
let result = svm.simulate_transaction(&[ix], &accounts);
```

Accounts are `&[(Pubkey, Account)]` — a slice of `(address, account_data)` pairs.

**TypeScript:**

```ts
const result = vm.processInstruction(ix, accounts);      // single instruction
const result = vm.processInstruction([ix1, ix2], accounts); // multiple
const result = vm.processTransaction([ix1, ix2], accounts);
const result = vm.simulateTransaction([ix1, ix2], accounts);
```

Accounts accept either an array or a named map (see [Accounts](accounts.md)):

```ts
vm.processInstruction(ix, [acct1, acct2]);
vm.processInstruction(ix, { source: acct1, destination: acct2 });
```

### Account Store

The SVM maintains a persistent account database. Accounts passed to execution are merged with the database automatically.

```rust
svm.set_account(pubkey, account);
let acct = svm.get_account(&pubkey);
svm.airdrop(&pubkey, 1_000_000_000);
svm.create_account(&pubkey, space, &owner);
```

```ts
vm.setAccount(pubkey, accountInfo);
const acct = vm.getAccount(pubkey);
vm.airdrop(pubkey, 1_000_000_000n);
vm.createAccount(pubkey, 0n, owner);
```

Builder-style (Rust):

```rust
let svm = QuasarSvm::new()
    .with_account(pubkey, account)
    .with_airdrop(&pubkey, 1_000_000_000)
    .with_create_account(&pubkey, 0, &owner);
```

### Snapshots

Save and restore account state for test isolation:

```rust
let snap = svm.snapshot();
// ... execute instructions ...
svm.restore(snap);
```

```ts
const snap = vm.snapshot();
// ... execute instructions ...
vm.restore(snap);
vm.snapshotFree(snap); // free without restoring
```

### Sysvars

Configure clock, rent, epoch schedule, and compute budget:

```rust
let svm = QuasarSvm::new().with_slot(100);
svm.sysvars.warp_to_slot(200);
```

```ts
vm.setClock({ slot: 100n, epochStartTimestamp: 0n, epoch: 0n, leaderScheduleEpoch: 0n, unixTimestamp: 0n });
vm.warpToSlot(200n);
vm.setRent(3480n);
vm.setEpochSchedule({ slotsPerEpoch: 432000n, leaderScheduleSlotOffset: 0n, warmup: false, firstNormalEpoch: 0n, firstNormalSlot: 0n });
vm.setComputeBudget(200_000n);
```

### Cleanup

TypeScript only — release native resources when done:

```ts
vm.free();
```

## ExecutionResult

Every execution returns an `ExecutionResult` with:

| Field | Rust | TypeScript |
|-------|------|------------|
| Status | `raw_result: Result<(), InstructionError>` | `status: ExecutionStatus` |
| Compute units | `compute_units_consumed: u64` | `computeUnits: bigint` |
| Execution time | `execution_time_us: u64` | `executionTimeUs: bigint` |
| Return data | `return_data: Vec<u8>` | `returnData: Uint8Array` |
| Resulting accounts | `resulting_accounts: Vec<(Pubkey, Account)>` | `accounts: TAccount[]` |
| Logs | `logs: Vec<String>` | `logs: string[]` |

### Inspecting Results

**Rust:**

```rust
// Status
result.assert_success();
result.assert_error(ProgramError::InsufficientFunds);
assert!(result.is_ok());
result.unwrap();  // panics with error + logs if failed
result.expect("transfer should succeed");

// Status enum
match result.status() {
    ExecutionStatus::Success => {},
    ExecutionStatus::Err(e) => {},
}

// Accounts
let acct = result.account(&pubkey);
let data = result.data(&pubkey);
let lamps = result.lamports(&pubkey);
result.print_logs();

// Borsh deserialization (requires "borsh" feature)
let state: MyState = result.account_data(&pubkey).unwrap();
```

**TypeScript:**

```ts
assertSuccess(result);
assertError(result, { type: "InsufficientFunds" });
assertError(result, { type: "Custom", code: 6001 });

if (result.status.ok) { /* success */ }
console.log(result.computeUnits);
console.log(result.logs);
```

### ProgramError

TypeScript uses a discriminated union:

```ts
type ProgramError =
  | { type: "InvalidArgument" }
  | { type: "InvalidInstructionData" }
  | { type: "InvalidAccountData" }
  | { type: "AccountDataTooSmall" }
  | { type: "InsufficientFunds" }
  | { type: "IncorrectProgramId" }
  | { type: "MissingRequiredSignature" }
  | { type: "AccountAlreadyInitialized" }
  | { type: "UninitializedAccount" }
  | { type: "MissingAccount" }
  | { type: "InvalidSeeds" }
  | { type: "ArithmeticOverflow" }
  | { type: "AccountNotRentExempt" }
  | { type: "InvalidAccountOwner" }
  | { type: "IncorrectAuthority" }
  | { type: "Immutable" }
  | { type: "BorshIoError" }
  | { type: "ComputeBudgetExceeded" }
  | { type: "Custom"; code: number }
  | { type: "Runtime"; message: string }
```
