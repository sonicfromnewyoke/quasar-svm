use std::cell::RefCell;
use std::ffi::CString;
use std::os::raw::c_char;

#[allow(dead_code)]
pub const QUASAR_OK: i32 = 0;
#[allow(dead_code)]
pub const QUASAR_ERR_NULL_POINTER: i32 = -1;
#[allow(dead_code)]
pub const QUASAR_ERR_INVALID_UTF8: i32 = -2;
#[allow(dead_code)]
pub const QUASAR_ERR_PROGRAM_LOAD: i32 = -3;
#[allow(dead_code)]
pub const QUASAR_ERR_EXECUTION: i32 = -4;
#[allow(dead_code)]
pub const QUASAR_ERR_OUT_OF_BOUNDS: i32 = -5;
#[allow(dead_code)]
pub const QUASAR_ERR_INTERNAL: i32 = -99;

thread_local! {
    static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
}

pub fn set_last_error(msg: impl Into<String>) {
    LAST_ERROR.with(|cell| {
        *cell.borrow_mut() = CString::new(msg.into()).ok();
    });
}

pub fn clear_last_error() {
    LAST_ERROR.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

pub fn last_error_ptr() -> *const c_char {
    LAST_ERROR.with(|cell| {
        cell.borrow()
            .as_ref()
            .map(|s| s.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}
