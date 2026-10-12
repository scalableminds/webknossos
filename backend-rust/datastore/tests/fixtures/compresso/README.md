# Compresso decoding oracles

Generated with the independent `compresso==3.2.2` encoder (`numpy==2.3.4`).
Every valid encoded fragment was decoded by this repository's
`webknossos-jni/src/include/compresso.hpp` and compared with its original
little-endian, x-fastest voxel bytes. No native code is linked into the datastore.

The full temporary corpus contained **1,848** matching encoder/native/Rust
cases. `cases.json` selects **324** cases for normal tests: label widths
1/2/4/8, versions 0/1, 4/6 connectivity, window widths 1/2/4/8, 3D windows,
ragged dimensions, all-zero/max/random labels and component-index thresholds.
The 18 entries in `jni_errors.json` were run through the actual repository JNI
wrapper, including boundary instruction errors, literal instructions and error
precedence. Corrupt tables are tested only in Rust; the native decoder has
unchecked accesses for those inputs.

`volumes/` contains 12 independent precomputed datasets (four label widths ×
plain/raw-sharded/gzip-sharded storage). Each has an offset, ragged edge chunks
and a missing chunk. Shards deliberately store fragments in reverse order with
padding and unsigned backward offset deltas. All stored fragments were checked
with the native decoder. Expected full/cropped voxels come from the original
NumPy arrays, with the deliberately missing chunk zeroed.

## Reproduction

Run from the repository root. Build fixture-only binaries into a temporary
directory, for example `/tmp/wk-compresso-repro`:

```sh
mkdir -p /tmp/wk-compresso-repro/classes
clang++ -std=c++17 -O2 -I webknossos-jni/src/include backend-rust/tools/compresso_fixture_decoder.cpp -o /tmp/wk-compresso-repro/native
rustc --edition=2024 backend-rust/tools/compresso_fixture_decoder.rs -o /tmp/wk-compresso-repro/rust
uv run --with compresso==3.2.2 --with numpy==2.3.4 python backend-rust/tools/generate_compresso_corpus.py --output /tmp/wk-compresso-repro/corpus --native-decoder /tmp/wk-compresso-repro/native --rust-decoder /tmp/wk-compresso-repro/rust
uv run --with compresso==3.2.2 --with numpy==2.3.4 python backend-rust/tools/generate_compresso_3d_windows.py --output /tmp/wk-compresso-repro/corpus --native-decoder /tmp/wk-compresso-repro/native --rust-decoder /tmp/wk-compresso-repro/rust
python3 backend-rust/tools/select_compresso_fixtures.py --corpus /tmp/wk-compresso-repro/corpus --manifest backend-rust/datastore/tests/fixtures/compresso/cases.json --output /tmp/wk-compresso-repro/selected
uv run --with compresso==3.2.2 --with numpy==2.3.4 python backend-rust/tools/generate_compresso_volumes.py --output /tmp/wk-compresso-repro/volumes --native-decoder /tmp/wk-compresso-repro/native
```

For JNI error fixtures, compile `compressoCompressor.cpp` and `jniutils.cpp`
into a shared library with `webknossos-jni/src/include` and the JDK's
`include` and platform `include/darwin` or `include/linux` directories.
On macOS use `clang++ -std=c++17 -shared -fPIC`; on Linux use the corresponding
shared-library flags. Then:

```sh
javac -d /tmp/wk-compresso-repro/classes backend-rust/tools/GenerateCompressoFixtures.java
python3 backend-rust/tools/generate_compresso_jni_errors.py --output /tmp/wk-compresso-repro/jni --classes /tmp/wk-compresso-repro/classes --library /absolute/path/to/compresso-jni.dylib
```

If a managed macOS Python names an unavailable SDK when building the encoder,
set `SDKROOT` to `xcrun --show-sdk-path` and point `LDSHARED`/`LDCXXSHARED`
to `clang++ -bundle -undefined dynamic_lookup -arch arm64 -isysroot` followed
by that SDK path. These are fixture-generation dependencies only.
