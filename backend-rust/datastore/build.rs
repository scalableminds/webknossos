//! Generate the protobuf messages the datastore serves (agglomerate skeletons and graphs,
//! `ListOfLong`) from the shared `webknossos-datastore/proto` files. `protox` parses them in pure
//! Rust, so no system `protoc` is required.
use std::{error::Error, path::Path};

const PROTO_DIR: &str = "../../webknossos-datastore/proto";
const PROTO_FILES: &[&str] = &[
    "SkeletonTracing.proto",
    "AgglomerateGraph.proto",
    "ListOfLong.proto",
];

fn main() -> Result<(), Box<dyn Error>> {
    let proto_dir = Path::new(PROTO_DIR);
    println!("cargo:rerun-if-changed=build.rs");
    for file in PROTO_FILES {
        println!("cargo:rerun-if-changed={}", proto_dir.join(file).display());
    }
    let descriptors = protox::compile(PROTO_FILES, [proto_dir])?;
    prost_build::Config::new().compile_fds(descriptors)?;
    Ok(())
}
