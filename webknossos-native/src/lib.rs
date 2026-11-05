//! Native functions for the WEBKNOSSOS datastore and tracingstore, called from Scala via JNI.
//!
//! Each `Java_…` function is the implementation of an `@native def` on the Scala side. Its name encodes the
//! fully qualified Scala class and method name, so moving or renaming either side breaks the binding (an
//! `UnsatisfiedLinkError` on first call). The functions only convert between Java and Rust types and leave the
//! actual work to plain Rust functions, which are unit tested without a JVM.
//!
//! The crate is a library (`rlib`) as well, so that `cargo test` can link against it.

#![allow(non_snake_case)] // JNI function names are mandated by the JNI spec

mod bucket_scanner;
mod jni_util;
