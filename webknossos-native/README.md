# Native Functions for WEBKNOSSOS (Rust)

This crate builds `webknossosNative0`, the JNI library with the native functions of the datastore and
tracingstore: scanning and rewriting volume buckets, Compresso decompression (via `compresso-rs`) and converting
Draco meshes to STL (via `draco-core`). It replaced a C++ library, `webknossos-jni`.

sbt builds the crate with cargo (`sbt compile`, via sbt-jni) and packages it as a resource at
`native/<arch>-<os>/`, from where `NativeLibrary.scala` loads it. Needs Rust 1.88+.

## Layout

- `src/jni_util.rs`: `run()` for the body of every JNI function (errors and panics become a Java
  `RuntimeException`) plus copying arrays between Java and Rust.
- One module per Scala class, e.g. `src/bucket_scanner.rs` for `NativeBucketScanner`. The logic lives in plain
  Rust functions with unit tests. The `Java_…` functions only convert their arguments and the result.
- The unit tests of a module live in `src/<module>/tests.rs` (declared by `#[cfg(test)] mod tests;` at the end of
  the module), so they can test private functions as well.

## Adding or changing a native function

1. Declare it as `@native def` in a Scala class that calls `NativeLibrary.ensureLoaded()`.
2. Add a `#[unsafe(no_mangle)] pub extern "system" fn Java_<class>_<method>` for it, like `countSegmentVoxels` in
   `src/bucket_scanner.rs`. The name encodes the fully qualified Scala class and method, so renaming or moving
   either side breaks the binding (an `UnsatisfiedLinkError` on the first call).
3. Run `cargo test`, `cargo clippy --all-targets` and `cargo fmt` here, then
   `sbt "testOnly backend.BucketScannerTestSuite backend.CompressorTestSuite"`.

The GitHub workflow `.github/workflows/webknossos_native.yml` runs the cargo checks and unit tests, but only for
pushes that change this crate.
