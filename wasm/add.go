// The smallest possible subject for step 3's de-risk.
//
// 🔴 THIS IS NOT THE EVALUATOR. It adds two integers. Its only job is to answer
// the one question everything else in step 3 depends on: CAN A WASM MODULE
// COMPILED FROM GO BE EXECUTED INSIDE THIS CLIENT AT ALL?
//
// The brief's §3b builds "the Go evaluator compiled to WebAssembly and hosted
// in the client as a native module". ⚠ That phrasing is not decoration —
// React Native's engine does not run WebAssembly, so there is no
// `WebAssembly.instantiate` to call and the runtime has to be embedded in
// native code. ADR-005 §4.3 says the same thing from the other side: "A
// WebAssembly runtime becomes a native module in the client".
//
// ➕ So the de-risk comes before the work, exactly as the `itms-services`
// dummy file came before the distribution certificate: if a module this small
// cannot run, nothing larger can, and that answer is worth one build rather
// than a week.
//
// ⚠ TWO SEPARABLE UNKNOWNS, AND THIS FILE ONLY CARRIES ONE OF THEM.
//   1. Can the client host a Wasm runtime at all?   ← the big risk
//   2. Can Go emit a module with a callable export? ← this file
// Keeping them separable is why the build compiles this in its own step: a
// failure in the Go step and a failure in the native build mean different
// things and cost different amounts.
package main

// `//go:wasmexport` makes the function callable by name from a host, rather
// than leaving `_start` as the only entry point. ⚠ It requires Go 1.24 or
// later, which is why the workflow pins a version instead of taking whatever
// the runner happens to ship.
//
//go:wasmexport add
func add(a int32, b int32) int32 {
	return a + b
}

// ⚠ REQUIRED EVEN THOUGH IT DOES NOTHING. A `wasip1` module is built as a
// command, so it needs a `main` — the host instantiates it, the runtime runs
// `_start`, and the exported function is then callable. *Removing this does
// not produce a library; it produces a build error.*
func main() {}
