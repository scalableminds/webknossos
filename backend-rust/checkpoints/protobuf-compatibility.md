# Annotation protobuf compatibility checkpoint

2026-10-09. Parent-owned bounded correction: `src/tracingstore_client.rs`, `tests/tracingstore_client.rs`, `tests/fixtures/annotation_proto_scala.json`, oracle/replay tools and fixture README. DONE; central full suite275 passed (session81350) and all-target clippy passed (session16209).

Prost defaults missing proto2 scalar fields. The prior decoder checked only root and layer required fields; malformed user-state messages were accepted even though ScalaPB rejected them. The decoder now checks required user-state fields and every nested Vec3Int/Vec3Double/AdditionalCoordinate occurrence. This preserves explicit zero values and Scala's per-occurrence duplicate-message validation. Existing unknown-group rejection is retained because the actual Scala parser rejects those groups too.

Evidence: 31 generated wire cases were executed against the repository's compiled ScalaPB parser using `AnnotationProtoOracle.java`; the resulting acceptance booleans were recorded in the fixture. Targeted Rust test `scala_pb_wire_corpus_preserves_nested_required_fields` passed (central target, session39666). The positive fixture additionally checks decoded field values. No Scala/proto source changed; oracle classes are temporary. `python3 backend-rust/tools/check_annotation_proto_scala.py` replays the checked-in cases when the compiled datastore classes and dependencyClasspath stream are available.

Full integrated suite and clippy are recorded by coordinator. No complete protobuf/HTTP parity claim. The generated Skeleton/Volume messages need their own contract coverage when their RPCs are added.
