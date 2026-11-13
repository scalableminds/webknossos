# Compresso decoding oracles

Codec correctness against the `compresso` Python package is covered by the
`compresso-rs` crate's own tests. The fixtures here only cover the datastore's
wrapper and read path.

The 18 entries in `jni_errors.json` were run through the actual repository JNI
wrapper, including boundary instruction errors, literal instructions and error
precedence. The two output-length messages were updated by hand for the
`maxOutputLength` bound of #10223. Since #10223 the native decoder rejects zero
steps (14), windows above 64 bits (15) and section sizes exceeding the input
(16), which the Rust wrapper reports with the same codes.

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
