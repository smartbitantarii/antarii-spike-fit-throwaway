import ExpoModulesCore

/**
 `SC-10` on iOS — the Swift half of the Rust hosting probe.

 ✅ **No shim, because Swift calls C natively.** The `extern "C"` functions in
 `evaluator/src/ffi.rs` are declared in `antarii_evaluator.h` and reachable
 directly — which is why iOS exercises the **decimal-string** path that
 specification §4.8 actually binds, while Android *(JNI)* proves only linkage.

 🔴 **THE SYMBOLS ARE WEAK-IMPORTED, so absence is a RESULT rather than a
 crash.** With the Rust archive missing they resolve to `nil`, the app still
 launches, and the probe reports `not-hosted`. *That is the whole design: a
 build which refuses to run teaches less than one which reports why — `F-12`'s
 lesson, paid for once already.*
 */
public class AntariiEvaluatorModule: Module {

  public func definition() -> ModuleDefinition {
    // Must match `requireOptionalNativeModule('AntariiEvaluatorModule')` and
    // the `apple.modules` entry in `expo-module.config.json`.
    Name("AntariiEvaluatorModule")

    Function("probeAdd") { (a: Int64, b: Int64) -> Int64 in
      // ⚠ The weak symbol is checked rather than called blind: calling a null
      // weak symbol traps, and a trap inside a bridge call surfaces in
      // JavaScript as an opaque failure with nothing to act on.
      guard antarii_probe_add != nil else {
        throw Exception(
          name: "AntariiEvaluatorNotLinked",
          description: "libantarii_evaluator.a was not linked — antarii_probe_add is null"
        )
      }
      return antarii_probe_add(a, b)
    }

    Function("probeDoubleDecimal") { (input: String) -> String? in
      guard antarii_probe_double_decimal != nil, antarii_probe_free != nil else {
        throw Exception(
          name: "AntariiEvaluatorNotLinked",
          description: "libantarii_evaluator.a was not linked — the string entry points are null"
        )
      }
      // 🔴 OWNERSHIP, AND IT IS THE ONE THING THAT CAN CORRUPT THE HEAP HERE.
      // Rust allocated the returned buffer, so Rust must free it. `String(
      // cString:)` COPIES, so the Swift value is independent of the buffer and
      // it is safe to release immediately afterwards. ✕ Returning without
      // freeing would leak on every call; using `free()` instead of
      // `antarii_probe_free` would be undefined behaviour.
      guard let raw = antarii_probe_double_decimal(input) else {
        // NULL is a stated result — "not a number this boundary accepts" —
        // never an error. §4.8's form only.
        return nil
      }
      let out = String(cString: raw)
      antarii_probe_free(raw)
      return out
    }
  }
}
