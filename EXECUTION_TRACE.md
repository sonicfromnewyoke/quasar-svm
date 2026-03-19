# Execution Trace Implementation

## Overview

Implemented a minimal execution trace API that makes it obvious where execution halted in complex transactions with nested CPIs.

## API Design

### Rust

```rust
pub struct ExecutionTrace {
    pub instructions: Vec<ExecutedInstruction>,
}

pub struct ExecutedInstruction {
    /// Nesting level: 0 = top-level instruction, 1+ = CPI depth
    pub nesting_level: u8,
    /// The program that was invoked
    pub program_id: Pubkey,
    /// Whether this specific invocation succeeded
    pub succeeded: bool,
}
```

### TypeScript

```typescript
export interface ExecutionTrace {
  instructions: ExecutedInstruction[];
}

export interface ExecutedInstruction {
  nestingLevel: number;
  programId: Uint8Array;
  succeeded: boolean;
}
```

## Example Output

### Simple Transaction (No CPIs)
```
Execution Trace (1 instructions):
  [0] L0 ✓ TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

### Failed Transaction
```
Execution Trace (1 instructions):
  [0] L0 ✗ TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

❌ Execution halted at:
  Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
  Nesting level: 0
```

### Complex Transaction with CPIs
```
Execution Trace (2 instructions):
  [0] L0 ✓ ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
  [1]   L1 ✗ TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

This clearly shows:
- ATA program (nesting level 0) succeeded ✓
- Token program CPI (nesting level 1) failed ✗

## Design Decisions

1. **Removed `stack_height`**: Use vector index instead
2. **Removed `accounts`**: Not needed for error debugging
3. **Kept `nesting_level`**: Essential for hierarchical "0.1.2" indices and showing CPI depth
4. **Added `succeeded`**: Explicitly computed, cannot be inferred (parent instructions can fail after their CPIs succeed)
5. **Changed to `program_id` (Pubkey)**: More useful than index

## Success Heuristic

- If overall result is `Ok`: all invocations `succeeded = true`
- If overall result is `Err`: last invocation `succeeded = false`, rest `true`

This is a conservative heuristic that handles most cases. The last instruction in the trace is typically the failure point.

## Wire Protocol Changes

### Before
```
u32 num_frames
for each frame:
  u32 stack_height
  u8  nesting_level
  u8  program_id_index
  u32 num_accounts
  [u8] accounts
```

### After
```
u32 num_instructions
for each instruction:
  u8     nesting_level
  [u8;32] program_id
  bool   succeeded
```

## Files Modified

### Rust (svm/)
- `src/svm.rs`: Updated `ExecutionTrace`, `ExecutedInstruction` structs and `extract_execution_trace()`
- `src/lib.rs`: Updated public exports and helper methods
- `tests/inner_instructions.rs`: Updated to use new API
- `tests/ata_inner_instructions.rs`: Updated to use new API
- `tests/execution_trace.rs`: Updated to use new API

### FFI (ffi/)
- `src/wire.rs`: Updated serialization to new format

### TypeScript (bindings/node/)
- `src/internal/types.ts`: Updated `ExecutedInstruction` and `ExecutionTrace` interfaces
- `src/internal/deserialize.ts`: Updated deserialization logic

## Benefits

1. **Clear failure point**: Immediately see which program and CPI level failed
2. **Minimal data**: Only what's needed for debugging
3. **Hierarchical**: Nesting level enables hierarchical indices (0, 0.1, 0.1.1, etc.)
4. **Visual**: Status marks (✓/✗) and indentation make traces easy to read
