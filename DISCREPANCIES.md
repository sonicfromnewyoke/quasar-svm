# API Discrepancy Report

## Overview

Documentation has been reorganized into layer-specific READMEs. This report highlights API inconsistencies between Rust, web3.js, and kit layers.

---

## Critical Issues (Breaks User Experience)

### 1. README Examples Reference Missing Functions

**Root README still shows old API from before commit c756073** which deleted instruction builders.

**Missing in web3.js/kit:**
- ❌ `createMintAccount()` - only `createKeyedMintAccount()` exists
- ❌ `createAssociatedTokenAccount()` - only `createKeyedAssociatedTokenAccount()` exists
- ❌ `tokenTransfer()` - no instruction builder (must use `@solana-program/token` directly)
- ❌ `tokenMintTo()` - no instruction builder
- ❌ `tokenBurn()` - no instruction builder
- ❌ `result.tokenBalance()` - method doesn't exist

**Missing builder methods:**
- ❌ `.addTokenProgram()` - programs loaded via constructor config instead
- ❌ `.addToken2022Program()`
- ❌ `.addAssociatedTokenProgram()`

**Impact:** All quick start examples in README will fail when copy-pasted.

**Fix Options:**
1. Restore instruction builders (`tokenTransfer()`, etc.) in TypeScript
2. Update README to use `@solana-program/token` instruction helpers
3. Restore builder methods or update docs to show config pattern

---

### 2. Missing Account Manipulation Methods (TypeScript)

**Rust has these methods** (`svm/src/svm.rs`):
```rust
✅ set_account(&mut self, account: Account)
✅ airdrop(&mut self, pubkey: &Pubkey, lamports: u64)
✅ create_account(&mut self, pubkey: &Pubkey, space: usize, owner: &Pubkey)
✅ set_token_balance(&mut self, address: &Pubkey, amount: u64)
✅ set_mint_supply(&mut self, address: &Pubkey, supply: u64)
```

**TypeScript has NONE of these.**

**Impact:** TypeScript users cannot manipulate accounts after VM creation. Must create all accounts upfront.

**Fix:** Implement missing methods in TypeScript or document this limitation.

---

### 3. Missing ExecutionResult Helper Methods (TypeScript)

**Rust helpers** (`svm/src/lib.rs`, `svm/src/token.rs`):
```rust
// Token-specific
✅ token_account(&self, address) -> Option<SplTokenAccount>
✅ mint_account(&self, address) -> Option<SplMint>
✅ token_balance(&self, address) -> Option<u64>
✅ mint_supply(&self, address) -> Option<u64>

// General
✅ lamports(&self, address) -> u64
✅ data(&self, address) -> Option<&[u8]>

// Execution trace
✅ print_execution_trace(&self)
✅ failure_instruction(&self) -> Option<&ExecutedInstruction>
✅ instructions_at_level(&self, level: u8)
✅ call_stack(&self) -> Vec<&ExecutedInstruction>
```

**TypeScript has:**
```typescript
✅ account(address) - overloaded with optional decoder
✅ isSuccess(), isError()
✅ assertSuccess(), assertError(), assertCustomError()
✅ printLogs()
❌ Missing ALL other helpers above
```

**Impact:** README shows `result.tokenBalance()` which doesn't exist. Users must manually decode accounts.

**Fix:** Implement helper methods or update documentation to show decoder pattern.

---

## Feature Gaps

### 4. No Builder-Style Method Chaining (TypeScript)

**Rust pattern:**
```rust
QuasarSvm::new()
    .with_token_program()
    .with_account(account)
    .with_slot(100)
    .with_compute_budget(200_000)
```

**TypeScript pattern:**
```typescript
const vm = new QuasarSvm({ token: true, token2022: true });
// No builder methods - must use mutating methods instead
```

**Recommendation:** Choose one pattern and make it consistent, or support both.

---

### 5. Missing Execution Trace Helper Methods (TypeScript)

The new execution trace API (`ExecutedInstruction`) has these Rust methods:

```rust
✅ print_execution_trace()
✅ failure_instruction() -> Option<&ExecutedInstruction>
✅ instructions_at_level(level: u8) -> Vec<&ExecutedInstruction>
✅ call_stack() -> Vec<&ExecutedInstruction>
```

**All missing in TypeScript.**

Users can access `result.executionTrace.instructions` directly but have no helper methods.

**Impact:** Less ergonomic debugging experience in TypeScript.

---

## Code Quality Issues

### 6. Unused RPC FFI Exports

**File:** `bindings/node/src/ffi.ts:78-95`

```typescript
export const quasar_rpc_new = lib.func("void *quasar_rpc_new()");
export const quasar_rpc_free = lib.func("void quasar_rpc_free(void *rpc)");
export const quasar_rpc_send_transaction = lib.func(...);
export const quasar_rpc_get_transaction = lib.func(...);
export const quasar_rpc_simulate_transaction = lib.func(...);
export const quasar_rpc_clear_transactions = lib.func(...);
```

- Never called in TypeScript
- Not implemented in Rust FFI layer (`ffi/src/ffi.rs`)
- Not documented

**Recommendation:** Remove or implement this feature.

---

### 7. Naming Inconsistencies in Documentation

**README claims:**
```markdown
| `@blueshift-gg/quasar-svm/web3.js` | `PublicKey` | `KeyedAccount` |
```

**Reality:**
- Uses `Address` (not `PublicKey`) - they're aliased via ambient types
- Uses `KeyedAccountInfo` (not `KeyedAccount`)

---

### 8. Missing .gitignore Entries

**Untracked files from git status:**
```
?? docs/.astro/
?? docs/node_modules/
```

**Note:** These are now deleted since we removed the docs/ directory.

---

## Summary by Priority

### Fix Immediately (Breaks User Code)
1. ✅ **Documentation reorganized** - layer-specific READMEs created
2. ❌ **README examples** - still reference old API (instruction builders, builder methods)
3. ❌ **Missing `result.tokenBalance()`** - referenced in README but doesn't exist

### Fix Soon (Feature Parity)
4. ❌ **Account manipulation** - no `airdrop()`, `setAccount()`, `createAccount()` in TypeScript
5. ❌ **ExecutionResult helpers** - missing `tokenBalance()`, `lamports()`, `data()`, etc.
6. ❌ **Execution trace helpers** - missing `printExecutionTrace()`, `callStack()`, etc.

### Consider (API Consistency)
7. ❌ **Builder methods** - TypeScript doesn't have `.with*()` / `.add*()` style methods
8. ❌ **Instruction builders** - `tokenTransfer()`, `tokenMintTo()`, `tokenBurn()` removed

### Cleanup
9. ❌ **Dead RPC code** - 6 unused FFI exports
10. ✅ **Docs directory deleted** - Astro setup removed

---

## Decisions Made

### 1. ✅ Instruction Builders - Use Canonical Libraries
**Decision:** NO instruction builders in quasar-svm. Users should use canonical libraries:
- **web3.js**: Use `@solana/spl-token` (e.g., `getTransferInstruction()`)
- **kit**: Use `@solana-program/token` (e.g., `getTransferInstruction()`)
- **Rust**: Keep existing `token_transfer()` helpers (native Rust convenience)

**Status:** ✅ README examples updated to use canonical libraries

### 2. ✅ Result Helpers - Use Decoder Pattern
**Decision:** NO convenience helpers like `tokenBalance()`, `lamports()`, `data()` in TypeScript.
- Users should use `result.account(address, decoder)` pattern with standard codecs
- Keeps API flexible and aligned with @solana ecosystem patterns
- Rust keeps its helpers (native Rust convenience)

**Status:** ✅ Decision made, README examples use decoder pattern

### 3. ✅ Builder Methods - Default Config Pattern
**Decision:** Use default constructor config. Builder methods exist but aren't required.
- Default: `new QuasarSvm()` loads all SPL programs
- Custom: `new QuasarSvm({ token: true, token2022: false })`
- No need to call `.addTokenProgram()` etc.

**Status:** ✅ README updated to show default config

### 4. ✅ Account Manipulation - Setup Upfront
**Decision:** NO runtime account manipulation in TypeScript (`airdrop()`, `setAccount()`, etc.).
- Users should set up account store correctly at the start
- Pass all accounts to `processInstruction()` / `processInstructionChain()`
- Simpler implementation, clearer data flow

**Status:** ✅ Decision made, Rust keeps these for convenience

---

### 5. ✅ Execution Trace Helpers - Keep Minimal
**Decision:** NO convenience helpers in TypeScript. Return raw execution trace.
- Users access `result.executionTrace.instructions` directly
- Users implement their own formatting/filtering as needed
- Keeps API minimal and flexible

**Status:** ✅ Decision made, Rust keeps helpers for convenience

### 6. ✅ Dead RPC Code - Removed
**Decision:** Remove unused RPC FFI exports.
- Removed 6 `quasar_rpc_*` functions from `bindings/node/src/ffi.ts`
- Cleaner codebase, no misleading unimplemented features

**Status:** ✅ Removed

---

## Summary - All Complete! 🎉

### ✅ Documentation
1. **Layer-specific READMEs created** - Rust, web3.js, kit each have comprehensive docs
2. **Root README updated** - Links to layer docs, fixed all examples
3. **Astro docs deleted** - Migrated to markdown, removed build artifacts

### ✅ API Decisions
4. **Instruction builders** - Use canonical libraries (`@solana/spl-token`, `@solana-program/token`)
5. **Result helpers** - Use decoder pattern (`result.account(addr, decoder)`)
6. **Builder methods** - Default config loads all programs, methods optional
7. **Account manipulation** - Setup upfront, no runtime methods in TypeScript
8. **Execution trace helpers** - Return raw trace, no convenience methods in TypeScript

### ✅ Cleanup
9. **Dead RPC code removed** - Deleted 6 unused FFI exports

---

## API Philosophy Summary

**TypeScript layers are intentionally minimal:**
- Use canonical ecosystem libraries for instructions (`@solana/spl-token`, `@solana-program/token`)
- Use standard decoders for account data (`@solana-program/token`, `@solana/codecs`)
- Access raw data structures directly (`executionTrace.instructions`)
- Setup accounts upfront, no runtime manipulation

**Rust layer provides more convenience:**
- Built-in instruction builders (`token_transfer()`, etc.)
- Result helpers (`token_balance()`, `lamports()`, etc.)
- Execution trace helpers (`print_execution_trace()`, `call_stack()`, etc.)
- Runtime account manipulation (`airdrop()`, `set_account()`, etc.)

This keeps TypeScript aligned with @solana ecosystem patterns while Rust provides native ergonomics.
