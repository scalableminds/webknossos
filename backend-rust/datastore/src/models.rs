//! DS1a: Play-JSON compatible data source models (`datasource-properties.json`), geometry
//! utilities and element-class helpers. Scala truth: `webknossos-datastore/.../models/**`,
//! `dataformats/MagLocator.scala`, `helpers/UPath.scala`, `helpers/UnsignedLong.scala`,
//! `util/geometry/*`. See ../../../checkpoints/datastore-ds1a.md.

pub mod annotation;
pub mod data_requests;
pub mod disk_writer;

pub use webknossos_common::{datasource, enums, geometry, json, source_paths, upath};

pub use datasource::{
    ADDITIONAL_COORDINATES_DIFFER, AdditionalAxis, AdditionalCoordinate, AxisOrder, BUCKET_LENGTH,
    CoordinateTransformation, DataLayerAttachments, DataSource, DataSourceId,
    FILENAME_DATASOURCE_PROPERTIES_JSON, LayerAttachment, LayerKind, LegacyDataVaultCredential,
    MagLocator, OnDiskDataSource, StaticLayer, ThinPlateSplineCorrespondences, UnusableDataSource,
    UsableDataSource, ViewConfiguration, VoxelSize, status,
};
pub use disk_writer::{DiskWriteError, update_data_source_on_disk};
pub use enums::{
    CoordinateTransformationType, DataFormat, ElementClass, LayerAttachmentDataformat,
    LayerAttachmentType, LayerCategory, LengthUnit,
};
pub use geometry::{BoundingBox, Vec3Double, Vec3Int};
pub use json::{JsError, JsResult};
pub use source_paths::{DataSourcePathInfo, DataSourceWithRootPathInfo, RealPathInfo};
pub use upath::{LocalPath, RemotePath, UPath, UPathError};

/// Whether `s` is a 24-character hexadecimal MongoDB ObjectId.
pub fn is_object_id(s: &str) -> bool {
    s.len() == 24 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The lowercase-normalized ObjectId if `s` is a valid one.
pub fn parse_object_id(s: &str) -> Option<String> {
    is_object_id(s).then(|| s.to_ascii_lowercase())
}
