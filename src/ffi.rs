use std::os::raw::c_char;
use std::panic::AssertUnwindSafe;
use std::slice;

use crate::error::*;
use crate::program_cache::loader_keys;
use crate::svm::QuasarSvm;
use crate::wire;

// ---------------------------------------------------------------------------
// Error query
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn quasar_last_error() -> *const c_char {
    last_error_ptr()
}

// ---------------------------------------------------------------------------
// VM lifecycle
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_new() -> *mut QuasarSvm {
    clear_last_error();
    match std::panic::catch_unwind(|| Box::into_raw(Box::new(QuasarSvm::new()))) {
        Ok(ptr) => ptr,
        Err(_) => {
            set_last_error("Panic during SVM creation");
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_free(svm: *mut QuasarSvm) {
    if !svm.is_null() {
        unsafe {
            drop(Box::from_raw(svm));
        }
    }
}

// ---------------------------------------------------------------------------
// Program management
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_add_program(
    svm: *mut QuasarSvm,
    program_id: *const [u8; 32],
    elf_data: *const u8,
    elf_len: u64,
) -> i32 {
    clear_last_error();
    if svm.is_null() || program_id.is_null() || elf_data.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    match std::panic::catch_unwind(AssertUnwindSafe(|| {
        let svm = unsafe { &*svm };
        let id = solana_pubkey::Pubkey::new_from_array(unsafe { *program_id });
        let elf = unsafe { slice::from_raw_parts(elf_data, elf_len as usize) };
        svm.add_program(&id, &loader_keys::LOADER_V3, elf);
        QUASAR_OK
    })) {
        Ok(code) => code,
        Err(_) => {
            set_last_error("Panic while loading program");
            QUASAR_ERR_PROGRAM_LOAD
        }
    }
}

// ---------------------------------------------------------------------------
// Sysvar configuration
// ---------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_set_clock(
    svm: *mut QuasarSvm,
    slot: u64,
    epoch_start_timestamp: i64,
    epoch: u64,
    leader_schedule_epoch: u64,
    unix_timestamp: i64,
) -> i32 {
    clear_last_error();
    if svm.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    let svm = unsafe { &mut *svm };
    svm.sysvars.clock = solana_clock::Clock {
        slot,
        epoch_start_timestamp,
        epoch,
        leader_schedule_epoch,
        unix_timestamp,
    };
    QUASAR_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_warp_to_slot(svm: *mut QuasarSvm, slot: u64) -> i32 {
    clear_last_error();
    if svm.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    let svm = unsafe { &mut *svm };
    svm.sysvars.warp_to_slot(slot);
    QUASAR_OK
}

#[allow(deprecated)]
#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_set_rent(
    svm: *mut QuasarSvm,
    lamports_per_byte_year: u64,
    exemption_threshold: f64,
    burn_percent: u8,
) -> i32 {
    clear_last_error();
    if svm.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    let svm = unsafe { &mut *svm };
    svm.sysvars.rent = solana_rent::Rent {
        lamports_per_byte_year,
        exemption_threshold,
        burn_percent,
    };
    QUASAR_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_set_epoch_schedule(
    svm: *mut QuasarSvm,
    slots_per_epoch: u64,
    leader_schedule_slot_offset: u64,
    warmup: bool,
    first_normal_epoch: u64,
    first_normal_slot: u64,
) -> i32 {
    clear_last_error();
    if svm.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    let svm = unsafe { &mut *svm };
    svm.sysvars.epoch_schedule = solana_epoch_schedule::EpochSchedule {
        slots_per_epoch,
        leader_schedule_slot_offset,
        warmup,
        first_normal_epoch,
        first_normal_slot,
    };
    QUASAR_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_set_compute_budget(svm: *mut QuasarSvm, max_units: u64) -> i32 {
    clear_last_error();
    if svm.is_null() {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    let svm = unsafe { &mut *svm };
    svm.compute_budget.compute_unit_limit = max_units;
    QUASAR_OK
}

// ---------------------------------------------------------------------------
// Execution — serialized bytes in, serialized bytes out
// ---------------------------------------------------------------------------

/// Execute a single instruction.
///
/// `instruction` / `instruction_len`: serialized instruction (wire format).
/// `accounts` / `accounts_len`: serialized accounts (wire format).
/// On success, `*result_out` and `*result_len_out` are set to the serialized
/// result buffer. Free with `quasar_result_free(ptr, len)`.
#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_process_instruction(
    svm: *mut QuasarSvm,
    instruction: *const u8,
    instruction_len: u64,
    accounts: *const u8,
    accounts_len: u64,
    result_out: *mut *mut u8,
    result_len_out: *mut u64,
) -> i32 {
    clear_last_error();
    if svm.is_null()
        || instruction.is_null()
        || accounts.is_null()
        || result_out.is_null()
        || result_len_out.is_null()
    {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    match std::panic::catch_unwind(AssertUnwindSafe(|| {
        let svm = unsafe { &mut *svm };
        let ix_bytes = unsafe { slice::from_raw_parts(instruction, instruction_len as usize) };
        let acct_bytes = unsafe { slice::from_raw_parts(accounts, accounts_len as usize) };

        let ix = match wire::deserialize_instruction(ix_bytes) {
            Ok(ix) => ix,
            Err(e) => {
                set_last_error(format!("Invalid instruction data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };
        let accts = match wire::deserialize_accounts(acct_bytes) {
            Ok(a) => a,
            Err(e) => {
                set_last_error(format!("Invalid accounts data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };

        let exec_result = svm.process_instruction(&ix, &accts);
        let logs = svm.drain_logs();
        write_result_out(result_out, result_len_out, &exec_result, logs);
        QUASAR_OK
    })) {
        Ok(code) => code,
        Err(_) => {
            set_last_error("Panic during instruction execution");
            QUASAR_ERR_INTERNAL
        }
    }
}

/// Execute a chain of instructions with shared, persisted account state.
///
/// `instructions` / `instructions_len`: count-prefixed serialized instructions.
/// `accounts` / `accounts_len`: serialized accounts (wire format).
#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_process_instruction_chain(
    svm: *mut QuasarSvm,
    instructions: *const u8,
    instructions_len: u64,
    accounts: *const u8,
    accounts_len: u64,
    result_out: *mut *mut u8,
    result_len_out: *mut u64,
) -> i32 {
    clear_last_error();
    if svm.is_null()
        || instructions.is_null()
        || accounts.is_null()
        || result_out.is_null()
        || result_len_out.is_null()
    {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    match std::panic::catch_unwind(AssertUnwindSafe(|| {
        let svm = unsafe { &mut *svm };
        let ix_bytes = unsafe { slice::from_raw_parts(instructions, instructions_len as usize) };
        let acct_bytes = unsafe { slice::from_raw_parts(accounts, accounts_len as usize) };

        let ixs = match wire::deserialize_instructions(ix_bytes) {
            Ok(v) => v,
            Err(e) => {
                set_last_error(format!("Invalid instructions data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };
        let accts = match wire::deserialize_accounts(acct_bytes) {
            Ok(a) => a,
            Err(e) => {
                set_last_error(format!("Invalid accounts data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };

        let exec_result = svm.process_instruction_chain(&ixs, &accts);
        let logs = svm.drain_logs();
        write_result_out(result_out, result_len_out, &exec_result, logs);
        QUASAR_OK
    })) {
        Ok(code) => code,
        Err(_) => {
            set_last_error("Panic during instruction chain execution");
            QUASAR_ERR_INTERNAL
        }
    }
}

/// Execute multiple instructions as a single atomic transaction.
///
/// `instructions` / `instructions_len`: count-prefixed serialized instructions.
/// `accounts` / `accounts_len`: serialized accounts (wire format).
#[unsafe(no_mangle)]
pub extern "C" fn quasar_svm_process_transaction(
    svm: *mut QuasarSvm,
    instructions: *const u8,
    instructions_len: u64,
    accounts: *const u8,
    accounts_len: u64,
    result_out: *mut *mut u8,
    result_len_out: *mut u64,
) -> i32 {
    clear_last_error();
    if svm.is_null()
        || instructions.is_null()
        || accounts.is_null()
        || result_out.is_null()
        || result_len_out.is_null()
    {
        set_last_error("Null pointer argument");
        return QUASAR_ERR_NULL_POINTER;
    }
    match std::panic::catch_unwind(AssertUnwindSafe(|| {
        let svm = unsafe { &mut *svm };
        let ix_bytes = unsafe { slice::from_raw_parts(instructions, instructions_len as usize) };
        let acct_bytes = unsafe { slice::from_raw_parts(accounts, accounts_len as usize) };

        let ixs = match wire::deserialize_instructions(ix_bytes) {
            Ok(v) => v,
            Err(e) => {
                set_last_error(format!("Invalid instructions data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };
        let accts = match wire::deserialize_accounts(acct_bytes) {
            Ok(a) => a,
            Err(e) => {
                set_last_error(format!("Invalid accounts data: {e}"));
                return QUASAR_ERR_EXECUTION;
            }
        };

        let exec_result = svm.process_transaction(&ixs, &accts);
        let logs = svm.drain_logs();
        write_result_out(result_out, result_len_out, &exec_result, logs);
        QUASAR_OK
    })) {
        Ok(code) => code,
        Err(_) => {
            set_last_error("Panic during transaction execution");
            QUASAR_ERR_INTERNAL
        }
    }
}

// ---------------------------------------------------------------------------
// Result deallocation
// ---------------------------------------------------------------------------

/// Free a serialized result buffer previously returned by an execution function.
/// Both the pointer and the length from the execution call must be provided.
#[unsafe(no_mangle)]
pub extern "C" fn quasar_result_free(result: *mut u8, result_len: u64) {
    if !result.is_null() {
        unsafe {
            let slice = slice::from_raw_parts_mut(result, result_len as usize);
            drop(Box::from_raw(slice as *mut [u8]));
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn write_result_out(
    result_out: *mut *mut u8,
    result_len_out: *mut u64,
    exec_result: &crate::svm::ExecutionResult,
    logs: Vec<String>,
) {
    let serialized = wire::serialize_result(exec_result, logs);
    let len = serialized.len();
    let ptr = Box::into_raw(serialized) as *mut u8;
    unsafe {
        *result_out = ptr;
        *result_len_out = len as u64;
    }
}
