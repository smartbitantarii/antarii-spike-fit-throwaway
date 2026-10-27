/**
 * Step 3's de-risk: can a Wasm module compiled from Go run inside this client?
 *
 * 🔴 THIS ANSWERS A QUESTION, IT DOES NOT BUILD A FEATURE. The brief's §3b
 * wants "the Go evaluator compiled to WebAssembly and hosted in the client as
 * a native module". Everything else in step 3 — writing the evaluator in Go,
 * writing the pricing resolver, provisioning condition 7's catalogue and price
 * rules — is ordinary work of known size. **This is the part nobody knows the
 * size of**, so it goes first and alone.
 *
 * ⚠ WHY A NATIVE MODULE IS NEEDED AT ALL, since it is easy to assume otherwise:
 * React Native's engine does not implement WebAssembly. There is no
 * `WebAssembly.instantiate` to call. ADR-005 §4.3 says the same from the other
 * side — "A WebAssembly runtime **becomes a native module** in the client".
 *
 * ✕ AND THE RUNTIME IS NOT A MAINTAINED DEPENDENCY. The only two candidates on
 * npm were last published in **May 2022** and **May 2023**, against Expo SDK 58
 * and React Native 0.88. `react-native-webassembly` pins AGP 7.2.1 and treats
 * the New Architecture as opt-in, so it may well not build at all. **That
 * outcome is a finding, not a setback**: ADR-005 §4.3 priced option B as
 * "adds a runtime", and the measured reality would be *adds a runtime you
 * maintain yourself*. ➕ The package vendors **wasm3's C sources**, so forking
 * is a real fallback rather than a vague one.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export interface WasmProbe {
  /** what the module returned for add(1, 2) — 3 if everything worked */
  result: number | null;
  /** how long instantiation took, which is the cost ADR-005 §4.3 cares about */
  instantiateMs: number;
  /** how long the call itself took */
  callMs: number;
  /** the module's size on the device */
  bytes: number;
  /** null when it worked; otherwise what refused, verbatim */
  failure: string | null;
}

/**
 * ⚠ RESOLVED THE DEFENSIVE WAY, THOUGH IT SHOULD NOT NEED TO BE.
 *
 * `F-4` recorded that a bundled IMAGE comes back as a bare Android drawable
 * name in a release build. A `.wasm` is not an image, so `expo-asset`'s
 * image-compatibility shortcut cannot fire and `downloadAsync()` really does
 * produce a file. ➕ The check is kept anyway because the reasoning depends on
 * Metro classifying the file the way `metro.config.js` asks it to, and **a
 * silent reclassification would produce exactly the F-4 symptom in a place
 * nobody would look for it.**
 */
async function moduleBytes(): Promise<{ uri: string; bytes: Uint8Array }> {
  const asset = Asset.fromModule(require('../../assets/add.wasm'));
  if (!asset.localUri?.includes(':')) {
    asset.localUri = null;
    asset.downloaded = false;
    await asset.downloadAsync();
  }
  if (!asset.localUri?.includes(':')) {
    throw new Error('the wasm module did not resolve to a file uri: ' + String(asset.localUri));
  }
  const bytes = await new File(asset.localUri).bytes();
  if (bytes.length === 0) throw new Error('the wasm module read back empty');

  // 🔴 The magic number, checked on the device as well as in CI. A file that
  // is not a Wasm module fails inside the runtime with whatever message that
  // runtime happens to produce, and "0061736d" is cheaper to read than a
  // wasm3 parse error.
  const magic = [...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (magic !== '0061736d') {
    throw new Error('assets/add.wasm does not start with the wasm magic number: ' + magic);
  }
  return { uri: asset.localUri, bytes };
}

/**
 * Instantiates the module and calls `add(1, 2)`.
 *
 * ⚠ EVERY FAILURE IS RETURNED, NEVER THROWN. The whole point of a de-risk is
 * the failure message — *which* step refused and *how* — and an exception that
 * reaches a generic handler loses exactly that. ➕ The import is dynamic for
 * the same reason: if the native module is missing from the build, that must
 * read as "the runtime is not there" rather than crash the screen on load.
 */
export async function probeWasm(): Promise<WasmProbe> {
  const out: WasmProbe = {
    result: null,
    instantiateMs: 0,
    callMs: 0,
    bytes: 0,
    failure: null,
  };

  let bytes: Uint8Array;
  try {
    const m = await moduleBytes();
    bytes = m.bytes;
    out.bytes = m.bytes.length;
  } catch (err) {
    out.failure = 'asset: ' + (err instanceof Error ? err.message : String(err));
    return out;
  }

  let instantiate: (b: Uint8Array) => Promise<{ instance: { exports: Record<string, unknown> } }>;
  try {
    const mod = (await import('react-native-webassembly')) as unknown as {
      instantiate: typeof instantiate;
      default?: { instantiate: typeof instantiate };
    };
    const api = mod.instantiate ? mod : mod.default;
    if (!api?.instantiate) throw new Error('the module exports no instantiate()');
    instantiate = api.instantiate;
  } catch (err) {
    out.failure = 'runtime absent: ' + (err instanceof Error ? err.message : String(err));
    return out;
  }

  try {
    const t0 = performance.now();
    const { instance } = await instantiate(bytes);
    out.instantiateMs = performance.now() - t0;

    const add = instance.exports.add as ((a: number, b: number) => number) | undefined;
    if (typeof add !== 'function') {
      out.failure =
        'instantiated, but no callable export named "add" (exports: ' +
        Object.keys(instance.exports ?? {}).join(', ') +
        ')';
      return out;
    }

    const t1 = performance.now();
    out.result = add(1, 2);
    out.callMs = performance.now() - t1;

    // ⚠ Asserted, not displayed and trusted. A runtime that returns a number
    // is not the same as a runtime that runs the module: a stub returning 0
    // would look like success on a screen showing only timings.
    if (out.result !== 3) {
      out.failure = 'add(1, 2) returned ' + out.result + ', not 3';
    }
  } catch (err) {
    out.failure = 'instantiate/call: ' + (err instanceof Error ? err.message : String(err));
  }

  return out;
}
