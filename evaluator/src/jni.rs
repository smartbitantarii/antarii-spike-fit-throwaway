//! Android's half of `SC-10`'s boundary — JNI, with no dependency.
//!
//! 🔴 **WHY ANDROID NEEDS THIS AND iOS DOES NOT.** Swift calls a C function
//! directly, so iOS uses `ffi.rs` unchanged. **Kotlin cannot**: the JVM
//! reaches native code only through JNI, whose symbol names encode the Java
//! package and class. *So the asymmetry is the platforms', not a design
//! choice — but it does mean the two sides prove slightly different things,
//! which is recorded rather than smoothed over.*
//!
//! ⚠ **WHAT THIS DELIBERATELY DOES NOT DO: strings.**
//!
//! A JNI string requires calling through the `JNIEnv` function table —
//! `GetStringUTFChars`, `NewStringUTF`, `ReleaseStringUTFChars` — which means
//! either the **`jni` crate** or a **C shim built by the NDK through CMake**.
//! Both are real machinery, and **neither is needed to answer the question the
//! narrowed spike asks**: *can a Rust library be hosted in this client at all?*
//!
//! ✅ **Two `jlong`s answer that**, and they need no `JNIEnv` call whatever —
//! the arguments arrive by value and the result returns by value.
//!
//! ✕ **So Android proves HOSTING and not MARSHALLING in this build**, while
//! iOS proves both. ➕ *If hosting works, adding the `jni` crate afterwards is
//! a small, well-trodden step; if hosting fails, we learned the expensive
//! thing without having paid for the bridge.*
//!
//! ---
//!
//! 🔴 **THE SYMBOL NAME IS A CONTRACT WITH THE KOTLIN SIDE AND NOTHING CHECKS
//! IT.** `Java_` + the package with `.` replaced by `_` + the class + the
//! method. A mismatch is not a compile error on either side — it is an
//! `UnsatisfiedLinkError` **at run time, on the device**. *So if the probe
//! reports "no route", this name and
//! `AntariiEvaluatorModule.kt`'s package are the first thing to compare.*

// `jlong` is specified as a signed 64-bit integer, so `i64` is exact rather
// than merely convenient. `jint` would be `i32`.
type JLong = i64;

/// `com.smartbitit.antarii.spike.evaluator.AntariiEvaluatorModule.nativeProbeAdd`
///
/// ➕ **The two leading parameters are JNI's, not ours**, and both are ignored:
/// `env` is the interface pointer and `class` is the `jclass` a *static*
/// native method receives. *They are named rather than elided so the signature
/// reads as the JNI contract it is — and because getting their order wrong is
/// another run-time-only failure.*
///
/// # Safety
/// Called only by the JVM, with JNI's own calling convention. It touches
/// neither pointer, so there is nothing here that can be unsound.
#[no_mangle]
pub unsafe extern "system" fn Java_com_smartbitit_antarii_spike_evaluator_AntariiEvaluatorModule_nativeProbeAdd(
    _env: *mut core::ffi::c_void,
    _class: *mut core::ffi::c_void,
    a: JLong,
    b: JLong,
) -> JLong {
    // Delegates to the same function iOS reaches through `extern "C"`, so the
    // two platforms cannot drift apart on what the probe computes.
    crate::ffi::antarii_probe_add(a, b)
}
