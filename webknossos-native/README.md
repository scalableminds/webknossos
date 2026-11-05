# Native Functions for WEBKNOSSOS (Rust)

This crate builds `webknossosNative0`, a JNI library with the native functions of the datastore and tracingstore.
It replaces the C++ library in `webknossos-jni` function by function. Until that is finished, both libraries are
loaded (see `NativeLibraries.scala`), and the JVM binds each `@native` method to whichever library exports it.

sbt builds the crate with cargo (`sbt compile`, via sbt-jni) and packages it as a resource at
`native/<arch>-<os>/`. Needs Rust 1.87+.

## Layout

- `src/jni_util.rs`: `run()` for the body of every JNI function (errors and panics become a Java
  `RuntimeException`) plus copying arrays between Java and Rust.
- One module per Scala class, e.g. `src/bucket_scanner.rs` for `NativeBucketScanner`. The logic lives in plain
  Rust functions with unit tests. The `Java_…` functions only convert their arguments and the result.

## Moving a function from C++ to Rust

1. Implement it in Rust and add a `#[unsafe(no_mangle)] pub extern "system" fn Java_<class>_<method>` for it,
   like `countSegmentVoxels` in `src/bucket_scanner.rs`. The name must match the Scala class and method exactly.
2. Delete the C++ implementation and its declaration in `webknossos-jni/src/include`. Otherwise both libraries
   export the symbol, and which one the JVM binds is undefined.
3. Run `cargo test`, `cargo clippy --all-targets` and `cargo fmt` here, then
   `sbt "testOnly backend.NativeGoldenTestSuite backend.BucketScannerTestSuite backend.CompressorTestSuite"`.
   `NativeGoldenTestSuite` compares all native functions against results recorded with the C++ implementation,
   see `test/native-golden/README.md`.

Behavior to keep when porting: the error cases of the C++ code (they throw `RuntimeException`), elements
read as little-endian, and segment ids missing from an id mapping become 0.
