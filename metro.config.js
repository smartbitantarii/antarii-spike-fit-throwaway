/**
 * Metro's bundler configuration — created for step 3's de-risk.
 *
 * 🔴 WITHOUT THIS, `require('../../assets/add.wasm')` DOES NOT RESOLVE.
 * Metro's default `assetExts` has no `wasm` entry, so a `.wasm` file is
 * neither bundled nor requirable — the failure is at bundle time and says
 * "unable to resolve module", which reads like a missing file rather than a
 * missing file *type*.
 *
 * ➕ And it changes what `expo-asset` does with the file, which `F-4` makes
 * worth knowing: a non-image asset carries no `width`/`height`, so the
 * image-compatibility shortcut that returns a bare Android drawable name
 * never fires, and `downloadAsync()` really does copy the file out. *The
 * defect that cost `S5` a build does not apply here — but only because the
 * asset is not an image, which is a reason worth writing down rather than a
 * coincidence worth relying on.*
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ⚠ Appended, never replaced. Assigning a fresh array here would drop every
// default extension — images, fonts, the S5 fixture — and the breakage would
// appear far from this line.
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

module.exports = config;
