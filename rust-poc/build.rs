fn main() {
    // Compile the repo's own FossilDB gRPC contract directly, rather than copying or
    // retyping it, so the PoC can't drift from what the Scala tracingstore actually
    // speaks. We only need the outer envelope (Get/GetRequest/GetReply) — the PoC
    // forwards annotation bytes as-is without decoding Annotation.proto etc.
    let proto_file = "../webknossos-datastore/proto/fossildbapi.proto";
    println!("cargo:rerun-if-changed={proto_file}");
    tonic_prost_build::configure()
        .build_server(false)
        .compile_protos(&[proto_file], &["../webknossos-datastore/proto"])
        .expect("failed to compile fossildbapi.proto");
}
