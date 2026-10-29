package com.smartbitit.antarii.spike.evaluator

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `SC-10` on Android — the Kotlin half of the Rust hosting probe.
 *
 * 🔴 THE PACKAGE AND CLASS NAME ABOVE ARE A CONTRACT WITH `jni.rs`, AND
 * NOTHING CHECKS IT. The Rust symbol is
 * `Java_com_smartbitit_antarii_spike_evaluator_AntariiEvaluatorModule_nativeProbeAdd`
 * — `Java_` plus this package with `.` replaced by `_`, plus this class, plus
 * the method. A mismatch compiles cleanly on both sides and fails as an
 * `UnsatisfiedLinkError` AT RUN TIME, ON THE DEVICE. If the probe reports
 * "no route", compare those two names first.
 */
class AntariiEvaluatorModule : Module() {

  override fun definition() = ModuleDefinition {
    // Must match `requireOptionalNativeModule('AntariiEvaluatorModule')`
    // and the `android.modules` entry in `expo-module.config.json`.
    Name("AntariiEvaluatorModule")

    Function("probeAdd") { a: Long, b: Long ->
      // ⚠ If `loadOk` is false the library never loaded, and calling the
      // external function would throw `UnsatisfiedLinkError` — which surfaces
      // in JavaScript as an opaque bridge error. Throwing with the recorded
      // reason instead means the probe can SAY why.
      if (!loadOk) {
        throw IllegalStateException("libantarii_evaluator.so did not load: $loadError")
      }
      nativeProbeAdd(a, b)
    }

    // ✕ `probeDoubleDecimal` IS DELIBERATELY ABSENT ON ANDROID. A JNI string
    // needs the `JNIEnv` function table — the `jni` crate or an NDK C shim —
    // and neither is needed to answer whether Rust can be hosted here.
    // `index.ts` treats its absence as the expected answer, not a failure,
    // and records that marshalling is NOT PROVEN on this platform.
  }

  private external fun nativeProbeAdd(a: Long, b: Long): Long

  companion object {
    private var loadOk = false
    private var loadError: String = "not attempted"

    init {
      // 🔴 WRAPPED, BECAUSE AN UNCAUGHT FAILURE HERE IS `F-12` AGAIN.
      // A throwing static initialiser kills the class — and in Expo's module
      // registry that happens during application start-up, BEFORE any
      // JavaScript runs. That is precisely how `expo-background-task` left the
      // handset unable to start, and the cause was unexplained for a day.
      // Catching it turns "the app will not start" into "the probe says why".
      try {
        System.loadLibrary("antarii_evaluator")
        loadOk = true
      } catch (t: Throwable) {
        loadError = t.javaClass.simpleName + ": " + (t.message ?: "no message")
      }
    }
  }
}
