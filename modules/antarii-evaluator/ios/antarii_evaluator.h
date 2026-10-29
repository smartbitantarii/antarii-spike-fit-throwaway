// `SC-10` — the C surface Swift calls, declared to match `evaluator/src/ffi.rs`.
//
// 🔴 NOTHING CHECKS THAT THIS MATCHES THE RUST. A wrong signature here links
// and then misbehaves at run time: wrong argument widths, a pointer read as an
// integer, or a crash. Keep the three declarations below identical in shape to
// the `#[no_mangle] pub extern "C"` functions in `ffi.rs`.
//
// ⚠ DECLARED WEAK, AND THAT IS WHAT MAKES THE PROBE A PROBE. With the archive
// absent the symbols resolve to NULL instead of failing the link, so the app
// still builds and runs and `AntariiEvaluatorModule.swift` can report
// `not-hosted` on screen. *A hard link failure would turn a probe result into
// a build failure — and `F-12` is two-day-old proof that a build which refuses
// to run teaches less than one that reports why.*

#ifndef ANTARII_EVALUATOR_H
#define ANTARII_EVALUATOR_H

#include <stdint.h>

#if defined(__cplusplus)
extern "C" {
#endif

/** Linkage probe: no allocation, no strings, cannot panic. */
__attribute__((weak_import))
int64_t antarii_probe_add(int64_t a, int64_t b);

/**
 * Marshalling probe — specification §4.8's decimal-string boundary.
 * Returns a newly allocated C string the caller MUST release with
 * `antarii_probe_free`, or NULL when the input is not §4.8's form.
 */
__attribute__((weak_import))
char *antarii_probe_double_decimal(const char *input);

/**
 * Releases a string from `antarii_probe_double_decimal`.
 * 🔴 The allocator that allocated must free: calling `free()` on that pointer
 * is undefined behaviour, because Rust's allocator and the platform's are not
 * required to be the same one.
 */
__attribute__((weak_import))
void antarii_probe_free(char *s);

#if defined(__cplusplus)
}
#endif

#endif /* ANTARII_EVALUATOR_H */
