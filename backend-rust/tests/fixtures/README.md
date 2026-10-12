# Annotation protobuf compatibility corpus

`annotation_proto_scala.json` records acceptance of 31 wire messages by the repository's compiled ScalaPB `AnnotationProto.parseFrom(byte[])`, using `tools/AnnotationProtoOracle.java`. It was recorded on 2026-10-09 against the existing Scala 3.8.3 datastore build and the shared `webknossos-datastore/proto` definitions.

The cases cover absent required fields at the root and in layers, user states, vectors and additional coordinates; explicit zero values; duplicate nested messages; unknown scalar/length-delimited fields and groups; truncation; and an empty message. Scala rejects a partially initialized duplicate embedded message even when an earlier occurrence was complete. Its unknown-field parser also rejects groups. The Rust decoder preserves those behaviors beyond Prost's default scalar initialization.

Ordinary Rust tests load these recorded expectations without Java or Scala. To replay their provenance after compiling the Scala datastore, run from the repository root:

```sh
python3 backend-rust/tools/check_annotation_proto_scala.py
```

This corpus verifies these wire cases only. It is not differential coverage of all tracing messages or HTTP routes. Unknown layer enums are additionally rejected by the Rust application's layer conversion boundary and are outside this parser corpus.
