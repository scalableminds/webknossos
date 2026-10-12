//! Protobuf messages shared with the datastore and tracing store, generated
//! by `build.rs` from `webknossos-datastore/proto/*.proto` (proto2).
//!
//! prost decodes missing proto2 `required` scalar fields as their defaults,
//! whereas ScalaPB rejects such messages. Callers that need the strict
//! behaviour must validate explicitly (see `tracingstore_client`).

/// Package `com.scalableminds.webknossos.datastore`.
#[allow(clippy::all, clippy::pedantic, missing_docs)]
pub mod datastore {
    include!(concat!(
        env!("OUT_DIR"),
        "/com.scalableminds.webknossos.datastore.rs"
    ));
}

pub use datastore::{
    AnnotationLayerProto, AnnotationLayerTypeProto, AnnotationProto, AnnotationUserStateProto,
    BoundingBoxProto, ColorProto, NamedBoundingBoxProto, SkeletonTracing, Vec3DoubleProto,
    Vec3IntProto, VolumeTracing,
};
