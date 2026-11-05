# Golden corpus for the native (JNI) library

`test/backend/NativeGoldenTestSuite.scala` pins the results of every function of the native library
(`webknossos-jni`) on a fixed input corpus. `expected.txt` holds one line per case. It was recorded with the
original C++ implementation, so any reimplementation must reproduce it exactly.

- Bucket scanner and voxel run inputs are generated from fixed seeds inside the suite.
- `draco/`: Draco mesh chunks.
  - `l4sample_*` and `e2006_*` are real chunks from the meshfiles of the public `l4_sample` and
    `Sample_e2006_wkw_with_reconstructed_neurons2` sample datasets (`scripts/extract_draco.py`).
  - `synthetic_*` were encoded with DracoPy using different quantization and compression levels
    (`scripts/gen_synthetic.py`).
- `compresso/`: label volumes of every data type, compressed with the reference Python `compresso` package
  (`scripts/gen_synthetic.py`).

The Draco results were re-recorded with the Rust port: the C++ library had been built on arm64, where clang fuses
the multiply-adds of the normal computation, so the last bits of the normals differed. Built with
`-ffp-contract=off` (like on x86_64), the C++ produced exactly the Rust results.

When a run fails, the suite writes all actual results to `target/native-golden-actual.txt`. To accept an
intended behavior change, copy that file over `expected.txt`.
