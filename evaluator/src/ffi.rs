//! `SC-10` — the C boundary the hosting probe crosses.
//!
//! 🔴 **WHAT THIS IS FOR, AND IT IS NOT THE EVALUATOR.** The narrowed spike
//! asks one question of axes 6 and 7: **can a Rust library be hosted in this
//! client and called from JavaScript at all?** Nothing has ever run Rust in
//! this stack — the earlier Go→WebAssembly attempt was reverted — so this is
//! an **integration** question, not a language or performance one.
//!
//! ⚠ **AND IT DOES NOT BREAK THE FREEZE.** The freeze says the evaluator will
//! not be **extended** — §§5 and 7–11 of the condition language stay unwritten.
//! This adds **no specification coverage**: it adds a boundary around the part
//! that already exists. *The distinction matters, so it is stated rather than
//! left to be noticed.*
//!
//! ➕ **Why `decimal` is the payload rather than something arbitrary.**
//! Specification §4.8 decides that **a number crosses every implementation
//! boundary as a decimal string** — *"the digits, an optional sign, and an
//! optional decimal point"* — and names **three boundaries this binds**,
//! including *"JavaScript ↔ the native library on the device"*. **This is that
//! boundary.** So the probe carries the thing the specification says crosses
//! it, and the frozen crate's 39 tests become the payload rather than a cost.
//!
//! ---
//!
//! 🔴 **TWO FUNCTIONS, BECAUSE A SINGLE FAILURE WOULD BE AMBIGUOUS.**
//!
//! | | What its failure means |
//! |---|---|
//! | `antarii_probe_add` | **linkage is broken** — the library did not load, or the symbol was not found |
//! | `antarii_probe_double_decimal` | **linkage works and marshalling does not** — a string, an allocation or an encoding problem |
//!
//! ⚠ *With only the string function, a failure could not be attributed — and
//! `F-12` is two-day-old proof that an unattributable integration failure
//! costs days. This is the same lesson as comparing `classes.dex` by sha256.*

use crate::decimal::Decimal;
use std::ffi::{c_char, CStr, CString};

/// The **linkage** probe: no allocation, no strings, no panics possible.
///
/// ➕ `wrapping_add` rather than `+` deliberately — a debug build panics on
/// overflow, and **a probe that can panic cannot distinguish "the library is
/// not reachable" from "the library is reachable and crashed"**, which is the
/// exact ambiguity this pair exists to remove.
#[no_mangle]
pub extern "C" fn antarii_probe_add(a: i64, b: i64) -> i64 {
    a.wrapping_add(b)
}

/// The **marshalling** probe: a decimal string in, a decimal string out.
///
/// Doubles the value, which is `x + x` — chosen because addition is the one
/// operation §4.4 says applies **no rounding**, so the result's scale is
/// predictable from the input's and the test can assert an exact string.
///
/// # Returns
/// A newly allocated C string the caller **must** release with
/// [`antarii_probe_free`], or **null** when the input was not the boundary
/// form §4.8 defines.
///
/// ⚠ **Null is a RESULT, not a crash** — *"not a number this boundary
/// accepts"*. A probe that aborted on bad input would report a hosting failure
/// for a data problem.
///
/// # Safety
/// `input` must be null or a valid NUL-terminated C string that stays valid
/// for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn antarii_probe_double_decimal(input: *const c_char) -> *mut c_char {
    if input.is_null() {
        return std::ptr::null_mut();
    }
    // ✕ Not `to_string_lossy`: lossy conversion would silently replace invalid
    // bytes and then fail to parse, reporting a parse failure for what is
    // really an encoding failure at the boundary.
    let Ok(text) = CStr::from_ptr(input).to_str() else {
        return std::ptr::null_mut();
    };
    match double_decimal(text) {
        Some(out) => match CString::new(out) {
            Ok(c) => c.into_raw(),
            // An interior NUL cannot occur in decimal digits; refused rather
            // than unwrapped, because `unwrap` in an `extern "C"` function
            // unwinds across the boundary, which is undefined behaviour.
            Err(_) => std::ptr::null_mut(),
        },
        None => std::ptr::null_mut(),
    }
}

/// Releases a string returned by [`antarii_probe_double_decimal`].
///
/// 🔴 **THE ALLOCATOR THAT ALLOCATED MUST FREE.** Rust's allocator and the
/// platform's are not required to be the same one, so the host calling
/// `free()` on this pointer is undefined behaviour. *Stated because it is the
/// single most common way an FFI boundary appears to work and corrupts the
/// heap — and a probe whose verdict is "it worked" while leaking or corrupting
/// would be worse than one that failed.*
///
/// # Safety
/// `s` must be null, or a pointer returned by
/// [`antarii_probe_double_decimal`] and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn antarii_probe_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// The safe inner function, so the logic is testable without `unsafe`.
///
/// ➕ Separated for the reason `expo-media.ts` states about judgements: *"it
/// imports nothing and is tested on a development machine"*. **The boundary is
/// what needs a device; the arithmetic does not.**
pub fn double_decimal(text: &str) -> Option<String> {
    let d = Decimal::parse(text)?;
    Some(d.add(&d).to_string())
}
