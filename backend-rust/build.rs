//! Generate protobuf message types from the shared datastore/tracingstore
//! `.proto` files. `protox` parses them in pure Rust, so no system `protoc`
//! is required and builds stay reproducible offline.
use std::{error::Error, path::Path};

const PROTO_DIR: &str = "../webknossos-datastore/proto";
/// Imported files (geometry, MetadataEntry, IdWithBool) are generated too.
const PROTO_FILES: &[&str] = &[
    "Annotation.proto",
    "SkeletonTracing.proto",
    "VolumeTracing.proto",
];

fn main() -> Result<(), Box<dyn Error>> {
    let proto_dir = Path::new(PROTO_DIR);
    println!("cargo:rerun-if-changed=build.rs");
    for entry in std::fs::read_dir(proto_dir)? {
        println!("cargo:rerun-if-changed={}", entry?.path().display());
    }
    let descriptors = protox::compile(PROTO_FILES, [proto_dir])?;
    prost_build::Config::new().compile_fds(descriptors)?;
    Ok(())
}
