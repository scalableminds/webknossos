//! Scala `models/datasource` + `dataformats/MagLocator`: the `DataSource` JSON
//! (`datasource-properties.json`, datastore ↔ WEBKNOSSOS RPCs).
//!
//! Field order of written JSON follows the Play writers (case-class order, `category` first,
//! `resolutions`/`numChannels` last, `largestSegmentId` after `mappings`). `None` fields are
//! omitted; attachment lists are always written.

use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::{Map, Value};

use super::enums::{
    CoordinateTransformationType, DataFormat, ElementClass, LayerAttachmentDataformat,
    LayerAttachmentType, LayerCategory, LengthUnit,
};
use super::geometry::{BoundingBox, Vec3Double, Vec3Int};
use super::json::{
    Fields, JsError, JsResult, PlayValue, deserialize_via_from_json, lookup, lookup_opt,
    play_f64_number, read_any, read_f64, read_i32, read_list, read_object, read_string,
    read_string_set,
};
use super::upath::UPath;

/// Scala `LayerViewConfiguration` / `DatasetViewConfiguration` (`Map[String, JsValue]`).
pub type ViewConfiguration = Map<String, Value>;

/// Scala `DataSourceStatus`.
pub mod status {
    pub const UNREPORTED: &str = "No longer available on datastore.";
    pub const DELETED_BY_USER: &str = "Deleted by user.";
    pub const NOT_YET_UPLOADED: &str = "Not yet fully uploaded.";
    pub const NOT_YET_UPLOADED_TO_PATHS: &str = "Not yet marked as fully uploaded to paths.";
    pub const NOT_IMPORTED_YET: &str = "Not imported yet.";
    pub const UNREPORTED_STATUS_LIST: &[&str] = &[UNREPORTED, DELETED_BY_USER];
    pub const INACTIVE_STATUS_LIST: &[&str] = &[
        UNREPORTED,
        NOT_YET_UPLOADED,
        NOT_YET_UPLOADED_TO_PATHS,
        DELETED_BY_USER,
    ];
}

/// Scala `UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON`.
pub const FILENAME_DATASOURCE_PROPERTIES_JSON: &str = "datasource-properties.json";

/// Scala `DataLayer.bucketLength`.
pub const BUCKET_LENGTH: i32 = 32;

/// Scala `DataSourceId`: written and read with the legacy keys `name` / `team`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DataSourceId {
    pub directory_name: String,
    pub organization_id: String,
}

impl DataSourceId {
    pub fn new(directory_name: impl Into<String>, organization_id: impl Into<String>) -> Self {
        Self {
            directory_name: directory_name.into(),
            organization_id: organization_id.into(),
        }
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        let name = lookup(json, "name", read_string)?;
        let team = lookup(json, "team", read_string)?;
        Ok(Self::new(name, team))
    }
}

impl std::fmt::Display for DataSourceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.organization_id, self.directory_name)
    }
}

impl Serialize for DataSourceId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("name", &self.directory_name)?;
        map.serialize_entry("team", &self.organization_id)?;
        map.end()
    }
}

/// Scala `VoxelSize`: read from a bare `[x, y, z]` (unit nanometer) or `{factor, unit}`;
/// always written as `{factor, unit}`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct VoxelSize {
    pub factor: Vec3Double,
    pub unit: LengthUnit,
}

impl VoxelSize {
    pub const DEFAULT_UNIT: LengthUnit = LengthUnit::Nanometer;

    pub fn from_factor_with_default_unit(factor: Vec3Double) -> Self {
        Self {
            factor,
            unit: Self::DEFAULT_UNIT,
        }
    }

    pub fn to_nanometer(&self) -> Vec3Double {
        self.factor.mul_scalar(self.unit.to_nanometer())
    }

    /// Scala `fromFactorAndUnitWithDefault`.
    pub fn from_factor_and_unit_with_default(factor: Vec3Double, unit: Option<LengthUnit>) -> Self {
        Self {
            factor,
            unit: unit.unwrap_or(Self::DEFAULT_UNIT),
        }
    }

    /// Scala `*(multiplier: Vec3Double)`.
    pub fn scaled(&self, multiplier: Vec3Double) -> Self {
        Self {
            factor: self.factor * multiplier,
            unit: self.unit,
        }
    }

    /// Scala `/(other: VoxelSize)`: factor ratio, via nanometers if the units differ.
    pub fn ratio(&self, other: &VoxelSize) -> Vec3Double {
        if self.unit == other.unit {
            self.factor / other.factor
        } else {
            self.to_nanometer() / other.to_nanometer()
        }
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        if let Ok(factor) = Vec3Double::from_json(json) {
            return Ok(Self::from_factor_with_default_unit(factor));
        }
        let mut fields = Fields::new(json);
        let factor = fields.req("factor", Vec3Double::from_json);
        let unit = fields.req("unit", LengthUnit::from_json);
        fields.finish()?;
        Ok(Self {
            factor: factor?,
            unit: unit?,
        })
    }
}

/// Scala `AxisOrder`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AxisOrder {
    pub x: i32,
    pub y: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c: Option<i32>,
}

impl AxisOrder {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let x = fields.req("x", read_i32);
        let y = fields.req("y", read_i32);
        let z = fields.opt("z", read_i32);
        let c = fields.opt("c", read_i32);
        fields.finish()?;
        Ok(Self {
            x: x?,
            y: y?,
            z: z?,
            c: c?,
        })
    }
}

/// Scala `LegacyDataVaultCredential` (inline `credentials` of a mag).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LegacyDataVaultCredential {
    pub user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

impl LegacyDataVaultCredential {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let user = fields.req("user", read_string);
        let password = fields.opt("password", read_string);
        fields.finish()?;
        Ok(Self {
            user: user?,
            password: password?,
        })
    }
}

/// Scala `MagLocator`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagLocator {
    pub mag: Vec3Int,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<UPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<LegacyDataVaultCredential>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_order: Option<AxisOrder>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
}

impl MagLocator {
    pub fn new(mag: Vec3Int) -> Self {
        Self {
            mag,
            path: None,
            credentials: None,
            axis_order: None,
            channel_index: None,
            credential_id: None,
        }
    }

    pub fn without_credentials(&self) -> Self {
        Self {
            credentials: None,
            credential_id: None,
            ..self.clone()
        }
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let mag = fields.req("mag", Vec3Int::mag_from_json);
        let path = fields.opt("path", UPath::from_json);
        let credentials = fields.opt("credentials", LegacyDataVaultCredential::from_json);
        let axis_order = fields.opt("axisOrder", AxisOrder::from_json);
        let channel_index = fields.opt("channelIndex", read_i32);
        let credential_id = fields.opt("credentialId", read_string);
        fields.finish()?;
        Ok(Self {
            mag: mag?,
            path: path?,
            credentials: credentials?,
            axis_order: axis_order?,
            channel_index: channel_index?,
            credential_id: credential_id?,
        })
    }

    /// Legacy Scala `WkwResolution` (`{resolution, cubeLength?, path?, credentialId?}`) →
    /// `toMagLocator` (cubeLength is dropped).
    pub fn from_wkw_resolution_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let resolution = fields.req("resolution", Vec3Int::mag_from_json);
        let _cube_length = fields.opt("cubeLength", read_i32);
        let path = fields.opt("path", UPath::from_json);
        let credential_id = fields.opt("credentialId", read_string);
        fields.finish()?;
        Ok(Self {
            path: path?,
            credential_id: credential_id?,
            ..Self::new(resolution?)
        })
    }
}

/// Scala `AdditionalAxis` (bounds: lower inclusive, upper exclusive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AdditionalAxis {
    pub name: String,
    pub bounds: Vec<i32>,
    pub index: i32,
}

impl AdditionalAxis {
    pub fn lower_bound(&self) -> Option<i32> {
        self.bounds.first().copied()
    }

    pub fn upper_bound(&self) -> Option<i32> {
        self.bounds.get(1).copied()
    }

    /// Scala `highestValue` (`upperBound - 1`).
    pub fn highest_value(&self) -> Option<i32> {
        self.upper_bound().map(|u| u.wrapping_sub(1))
    }

    /// Scala `intersectWithAdditionalCoordinates`: width-1 axis at the matching coordinate, or
    /// at the lower bound if no coordinate names this axis.
    pub fn intersect_with_additional_coordinates(
        &self,
        coordinates: &[AdditionalCoordinate],
    ) -> Self {
        let value = coordinates
            .iter()
            .find(|c| c.name == self.name)
            .map(|c| c.value)
            .unwrap_or_else(|| self.lower_bound().unwrap_or_default());
        Self {
            name: self.name.clone(),
            bounds: vec![value, value.wrapping_add(1)],
            index: self.index,
        }
    }

    /// Scala `mergeAndAssertSameAdditionalAxes`.
    pub fn merge_and_assert_same<'a>(
        axes: impl IntoIterator<Item = Option<&'a [AdditionalAxis]>> + Clone,
    ) -> Result<Option<Vec<AdditionalAxis>>, &'static str> {
        let merged = Self::merge(axes.clone());
        let merged_count = merged.as_ref().map_or(0, Vec::len);
        let same = axes
            .into_iter()
            .all(|a| a.map_or(0, <[AdditionalAxis]>::len) == merged_count);
        if same {
            Ok(merged)
        } else {
            Err(ADDITIONAL_COORDINATES_DIFFER)
        }
    }

    /// Scala `coordinateSpace`: every combination of axis values (first axis outermost).
    pub fn coordinate_space(axes: Option<&[AdditionalAxis]>) -> Vec<Vec<AdditionalCoordinate>> {
        let Some(axes) = axes else {
            return Vec::new();
        };
        let mut space: Vec<Vec<AdditionalCoordinate>> = vec![Vec::new()];
        for axis in axes {
            let (lower, upper) = (
                axis.lower_bound().unwrap_or_default(),
                axis.upper_bound().unwrap_or_default(),
            );
            space = space
                .into_iter()
                .flat_map(|prefix| {
                    (lower..upper).map(move |value| {
                        let mut next = prefix.clone();
                        next.push(AdditionalCoordinate {
                            name: axis.name.clone(),
                            value,
                        });
                        next
                    })
                })
                .collect();
        }
        space
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let name = fields.req("name", read_string);
        let bounds = fields.req("bounds", |v| read_list(v, read_i32));
        let index = fields.req("index", read_i32);
        fields.finish()?;
        Ok(Self {
            name: name?,
            bounds: bounds?,
            index: index?,
        })
    }

    /// Scala `AdditionalAxis.merge`: per name, min lower / max upper bound, first index wins.
    /// Output order is first-seen order (Scala iterates a hash map, i.e. unspecified order).
    pub fn merge<'a>(
        axes: impl IntoIterator<Item = Option<&'a [AdditionalAxis]>>,
    ) -> Option<Vec<AdditionalAxis>> {
        let mut merged: Vec<AdditionalAxis> = Vec::new();
        for axis in axes.into_iter().flatten().flatten() {
            let (lower, upper) = (
                axis.lower_bound().unwrap_or_default(),
                axis.upper_bound().unwrap_or_default(),
            );
            match merged.iter_mut().find(|m| m.name == axis.name) {
                Some(existing) => {
                    existing.bounds =
                        vec![existing.bounds[0].min(lower), existing.bounds[1].max(upper)];
                }
                None => merged.push(AdditionalAxis {
                    name: axis.name.clone(),
                    bounds: vec![lower, upper],
                    index: axis.index,
                }),
            }
        }
        (!merged.is_empty()).then_some(merged)
    }
}

/// Scala `Msg.Dataset.additionalCoordinatesDiffer`.
pub const ADDITIONAL_COORDINATES_DIFFER: &str = "Additional coordinates differ in merged units.";

/// Scala `AdditionalCoordinate` (`models/DataRequests.scala`; the request-only `batchSize`
/// field is not modelled here).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct AdditionalCoordinate {
    pub name: String,
    pub value: i32,
}

/// Scala `ThinPlateSplineCorrespondences`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ThinPlateSplineCorrespondences {
    pub source: Vec<Vec3Double>,
    pub target: Vec<Vec3Double>,
}

impl ThinPlateSplineCorrespondences {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let source = fields.req("source", |v| read_list(v, Vec3Double::from_json));
        let target = fields.req("target", |v| read_list(v, Vec3Double::from_json));
        fields.finish()?;
        Ok(Self {
            source: source?,
            target: target?,
        })
    }
}

/// Scala `CoordinateTransformation`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CoordinateTransformation {
    #[serde(rename = "type")]
    pub transformation_type: CoordinateTransformationType,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_matrix"
    )]
    pub matrix: Option<Vec<Vec<f64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correspondences: Option<ThinPlateSplineCorrespondences>,
}

fn serialize_matrix<S: Serializer>(
    matrix: &Option<Vec<Vec<f64>>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let rendered: Option<Vec<Vec<Value>>> = matrix.as_ref().map(|rows| {
        rows.iter()
            .map(|row| {
                row.iter()
                    .map(|v| play_f64_number(*v).map_or(Value::Null, Value::Number))
                    .collect()
            })
            .collect()
    });
    rendered.serialize(serializer)
}

impl CoordinateTransformation {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let transformation_type = fields.req("type", CoordinateTransformationType::from_json);
        let matrix = fields.opt("matrix", |v| read_list(v, |row| read_list(row, read_f64)));
        let correspondences =
            fields.opt("correspondences", ThinPlateSplineCorrespondences::from_json);
        fields.finish()?;
        Ok(Self {
            transformation_type: transformation_type?,
            matrix: matrix?,
            correspondences: correspondences?,
        })
    }
}

/// Scala `LayerAttachment`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerAttachment {
    pub name: String,
    pub path: UPath,
    pub data_format: LayerAttachmentDataformat,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
}

impl LayerAttachment {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let name = fields.req("name", read_string);
        let path = fields.req("path", UPath::from_json);
        let data_format = fields.req("dataFormat", LayerAttachmentDataformat::from_json);
        let credential_id = fields.opt("credentialId", read_string);
        fields.finish()?;
        Ok(Self {
            name: name?,
            path: path?,
            data_format: data_format?,
            credential_id: credential_id?,
        })
    }

    pub fn resolved_in(&self, data_source_path: &UPath) -> Self {
        Self {
            path: self.path.resolved_in(data_source_path),
            ..self.clone()
        }
    }

    pub fn relativized_in(&self, data_source_path: &UPath) -> Self {
        Self {
            path: self.path.relativized_in(data_source_path),
            ..self.clone()
        }
    }

    pub fn without_credential(&self) -> Self {
        Self {
            credential_id: None,
            ..self.clone()
        }
    }

    /// Scala `localPath` (fails for remote and zip paths).
    pub fn local_path(&self) -> Result<std::path::PathBuf, crate::error::DsError> {
        self.path.to_local_path()
    }

    /// Scala `resolvedPath`: relative paths resolve in `<dataBaseDir>/<organization>/<directory>`.
    pub fn resolved_path(&self, data_base_dir: &std::path::Path, id: &DataSourceId) -> UPath {
        let dataset_path = UPath::from_local_path(data_base_dir)
            .join(&id.organization_id)
            .join(&id.directory_name);
        self.path.resolved_in(&dataset_path)
    }
}

/// Scala `DataLayerAttachments` (`Json.using[WithDefaultValues]`: lists default to empty and
/// are always written; singletons are omitted when absent).
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLayerAttachments {
    pub meshes: Vec<LayerAttachment>,
    pub agglomerates: Vec<LayerAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_index: Option<LayerAttachment>,
    pub connectomes: Vec<LayerAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumsum: Option<LayerAttachment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_statistics: Option<LayerAttachment>,
}

impl DataLayerAttachments {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let list = |v: &Value| read_list(v, LayerAttachment::from_json);
        let mut fields = Fields::new(json);
        let meshes = fields.with_default("meshes", Vec::new(), list);
        let agglomerates = fields.with_default("agglomerates", Vec::new(), list);
        let segment_index = fields.opt("segmentIndex", LayerAttachment::from_json);
        let connectomes = fields.with_default("connectomes", Vec::new(), list);
        let cumsum = fields.opt("cumsum", LayerAttachment::from_json);
        let segment_statistics = fields.opt("segmentStatistics", LayerAttachment::from_json);
        fields.finish()?;
        Ok(Self {
            meshes: meshes?,
            agglomerates: agglomerates?,
            segment_index: segment_index?,
            connectomes: connectomes?,
            cumsum: cumsum?,
            segment_statistics: segment_statistics?,
        })
    }

    /// Scala `allAttachments` (meshes, agglomerates, segmentIndex, connectomes, cumsum,
    /// segmentStatistics).
    pub fn all_attachments(&self) -> Vec<&LayerAttachment> {
        self.meshes
            .iter()
            .chain(&self.agglomerates)
            .chain(&self.segment_index)
            .chain(&self.connectomes)
            .chain(&self.cumsum)
            .chain(&self.segment_statistics)
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.all_attachments().is_empty()
    }

    /// Scala `mergeWithPrecedence`: own non-empty entries win.
    pub fn merge_with_precedence(&self, other: &Self) -> Self {
        let pick = |own: &Vec<LayerAttachment>, theirs: &Vec<LayerAttachment>| {
            if own.is_empty() {
                theirs.clone()
            } else {
                own.clone()
            }
        };
        Self {
            meshes: pick(&self.meshes, &other.meshes),
            agglomerates: pick(&self.agglomerates, &other.agglomerates),
            segment_index: self
                .segment_index
                .clone()
                .or_else(|| other.segment_index.clone()),
            connectomes: pick(&self.connectomes, &other.connectomes),
            cumsum: self.cumsum.clone().or_else(|| other.cumsum.clone()),
            segment_statistics: self
                .segment_statistics
                .clone()
                .or_else(|| other.segment_statistics.clone()),
        }
    }

    /// Scala `withAdded`.
    pub fn with_added(&self, attachment: LayerAttachment, kind: LayerAttachmentType) -> Self {
        let mut result = self.clone();
        match kind {
            LayerAttachmentType::Mesh => result.meshes.push(attachment),
            LayerAttachmentType::Agglomerate => result.agglomerates.push(attachment),
            LayerAttachmentType::SegmentIndex => result.segment_index = Some(attachment),
            LayerAttachmentType::Connectome => result.connectomes.push(attachment),
            LayerAttachmentType::Cumsum => result.cumsum = Some(attachment),
            LayerAttachmentType::SegmentStatistics => result.segment_statistics = Some(attachment),
        }
        result
    }

    /// Scala `getByTypeAndName`.
    pub fn get_by_type_and_name(
        &self,
        kind: LayerAttachmentType,
        name: &str,
    ) -> Option<&LayerAttachment> {
        let by_name = |a: &&LayerAttachment| a.name == name;
        match kind {
            LayerAttachmentType::Mesh => self.meshes.iter().find(by_name),
            LayerAttachmentType::Agglomerate => self.agglomerates.iter().find(by_name),
            LayerAttachmentType::SegmentIndex => self.segment_index.as_ref().filter(by_name),
            LayerAttachmentType::Connectome => self.connectomes.iter().find(by_name),
            LayerAttachmentType::Cumsum => self.cumsum.as_ref().filter(by_name),
            LayerAttachmentType::SegmentStatistics => {
                self.segment_statistics.as_ref().filter(by_name)
            }
        }
    }

    /// Scala `getByTypeAndNameAlwaysReturnSingletons`.
    pub fn get_by_type_and_name_always_return_singletons(
        &self,
        kind: LayerAttachmentType,
        name: &str,
    ) -> Option<&LayerAttachment> {
        match kind {
            LayerAttachmentType::SegmentIndex => self.segment_index.as_ref(),
            LayerAttachmentType::Cumsum => self.cumsum.as_ref(),
            LayerAttachmentType::SegmentStatistics => self.segment_statistics.as_ref(),
            _ => self.get_by_type_and_name(kind, name),
        }
    }

    /// Scala `mapped`.
    pub fn mapped(&self, f: impl Fn(&LayerAttachment) -> LayerAttachment) -> Self {
        Self {
            meshes: self.meshes.iter().map(&f).collect(),
            agglomerates: self.agglomerates.iter().map(&f).collect(),
            segment_index: self.segment_index.as_ref().map(&f),
            connectomes: self.connectomes.iter().map(&f).collect(),
            cumsum: self.cumsum.as_ref().map(&f),
            segment_statistics: self.segment_statistics.as_ref().map(&f),
        }
    }

    /// Scala `mappedWithType`.
    pub fn mapped_with_type(
        &self,
        f: impl Fn(&LayerAttachment, LayerAttachmentType) -> LayerAttachment,
    ) -> Self {
        use LayerAttachmentType as T;
        Self {
            meshes: self.meshes.iter().map(|a| f(a, T::Mesh)).collect(),
            agglomerates: self
                .agglomerates
                .iter()
                .map(|a| f(a, T::Agglomerate))
                .collect(),
            segment_index: self.segment_index.as_ref().map(|a| f(a, T::SegmentIndex)),
            connectomes: self
                .connectomes
                .iter()
                .map(|a| f(a, T::Connectome))
                .collect(),
            cumsum: self.cumsum.as_ref().map(|a| f(a, T::Cumsum)),
            segment_statistics: self
                .segment_statistics
                .as_ref()
                .map(|a| f(a, T::SegmentStatistics)),
        }
    }

    /// Scala `dropMissing`: keep only attachments whose name exists in `other`'s matching
    /// collection; `None` if nothing remains.
    pub fn drop_missing(&self, other: &Self) -> Option<Self> {
        let keep = |own: &[LayerAttachment], theirs: &[LayerAttachment]| -> Vec<LayerAttachment> {
            own.iter()
                .filter(|a| theirs.iter().any(|t| t.name == a.name))
                .cloned()
                .collect()
        };
        let keep_one = |own: &Option<LayerAttachment>, theirs: &Option<LayerAttachment>| {
            own.clone()
                .filter(|a| theirs.as_ref().is_some_and(|t| t.name == a.name))
        };
        let filtered = Self {
            meshes: keep(&self.meshes, &other.meshes),
            agglomerates: keep(&self.agglomerates, &other.agglomerates),
            segment_index: keep_one(&self.segment_index, &other.segment_index),
            connectomes: keep(&self.connectomes, &other.connectomes),
            cumsum: keep_one(&self.cumsum, &other.cumsum),
            segment_statistics: keep_one(&self.segment_statistics, &other.segment_statistics),
        };
        (!filtered.is_empty()).then_some(filtered)
    }

    /// Scala `renameByMap`: `(type, old name) -> new name`.
    pub fn rename_by_map(
        &self,
        renaming: &std::collections::HashMap<(LayerAttachmentType, String), String>,
    ) -> Self {
        self.mapped_with_type(|a, kind| LayerAttachment {
            name: renaming
                .get(&(kind, a.name.clone()))
                .cloned()
                .unwrap_or_else(|| a.name.clone()),
            ..a.clone()
        })
    }

    /// Scala `resolvedIn`.
    pub fn resolved_in(&self, data_source_path: &UPath) -> Self {
        self.mapped(|a| a.resolved_in(data_source_path))
    }

    /// Scala `relativizedIn`.
    pub fn relativized_in(&self, data_source_path: &UPath) -> Self {
        self.mapped(|a| a.relativized_in(data_source_path))
    }

    /// Scala `containsDuplicateNames` (meshes, agglomerates, connectomes).
    pub fn contains_duplicate_names(&self) -> bool {
        let has_duplicates = |list: &[LayerAttachment]| {
            let mut seen = std::collections::HashSet::new();
            !list.iter().all(|a| seen.insert(a.name.as_str()))
        };
        has_duplicates(&self.meshes)
            || has_duplicates(&self.agglomerates)
            || has_duplicates(&self.connectomes)
    }
}

/// Category-specific part of a [`StaticLayer`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayerKind {
    Color,
    Segmentation {
        /// uint64 bit pattern (Scala `Option[Long]` holding an `UnsignedLong`).
        largest_segment_id: Option<u64>,
        /// Scala `Option[Set[String]]`, duplicates removed, first-seen order.
        mappings: Option<Vec<String>>,
    },
}

/// Scala `StaticLayer` (`StaticColorLayer` / `StaticSegmentationLayer`).
#[derive(Debug, Clone, PartialEq)]
pub struct StaticLayer {
    pub name: String,
    pub data_format: DataFormat,
    pub bounding_box: BoundingBox,
    pub element_class: ElementClass,
    pub mags: Vec<MagLocator>,
    pub default_view_configuration: Option<ViewConfiguration>,
    pub admin_view_configuration: Option<ViewConfiguration>,
    pub coordinate_transformations: Option<Vec<CoordinateTransformation>>,
    pub additional_axes: Option<Vec<AdditionalAxis>>,
    pub attachments: Option<DataLayerAttachments>,
    pub kind: LayerKind,
}

/// Scala `UnsignedLong` reads: bigint envelope or plain number (`BigDecimal.toLong`).
pub fn read_unsigned_long(json: &Value) -> JsResult<u64> {
    match json {
        Value::Object(object)
            if object.get("customJsonEncoding").and_then(Value::as_str) == Some("bigint") =>
        {
            let value = lookup(json, "value", read_string)?;
            parse_unsigned_long(&value)
                .ok_or_else(|| JsError::new("error.expected.unsignedLongString"))
        }
        Value::Number(n) => Ok(if let Some(v) = n.as_u64() {
            v
        } else if let Some(v) = n.as_i64() {
            v as u64
        } else {
            big_decimal_to_long_bits(n.as_f64().unwrap_or_default())
        }),
        _ => Err(JsError::new(
            "error.expected.unsignedLongEnvelopeOrJsstringOrJsnumber",
        )),
    }
}

/// Java `Long.parseUnsignedLong` (optional `+`, ASCII digits, ≤ 2^64-1).
fn parse_unsigned_long(s: &str) -> Option<u64> {
    let digits = s.strip_prefix('+').unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Scala `BigDecimal.toLong` of a float: truncate, then keep the low 64 bits.
fn big_decimal_to_long_bits(value: f64) -> u64 {
    if !value.is_finite() {
        return 0;
    }
    let truncated = value.trunc();
    if truncated.abs() < (1u64 << 63) as f64 {
        return (truncated as i64) as u64;
    }
    // |value| ≥ 2^63: an integer m·2^e with e > 0; keep the low 64 bits of the magnitude.
    let bits = truncated.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i64 - 1075;
    let mantissa = (bits & ((1u64 << 52) - 1)) | (1u64 << 52);
    let magnitude = if exponent >= 64 {
        0
    } else {
        mantissa.wrapping_shl(exponent as u32)
    };
    if truncated < 0.0 {
        magnitude.wrapping_neg()
    } else {
        magnitude
    }
}

/// Scala `UnsignedLong` writes: `{"customJsonEncoding":"bigint","value":"<decimal>"}`.
pub fn unsigned_long_envelope(value: u64) -> Value {
    serde_json::json!({"customJsonEncoding": "bigint", "value": value.to_string()})
}

/// Largest integer written as a plain number by the disk writer (2^53 - 1).
pub const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

impl StaticLayer {
    pub fn category(&self) -> LayerCategory {
        match self.kind {
            LayerKind::Color => LayerCategory::Color,
            LayerKind::Segmentation { .. } => LayerCategory::Segmentation,
        }
    }

    pub fn is_segmentation(&self) -> bool {
        matches!(self.kind, LayerKind::Segmentation { .. })
    }

    pub fn largest_segment_id(&self) -> Option<u64> {
        match &self.kind {
            LayerKind::Segmentation {
                largest_segment_id, ..
            } => *largest_segment_id,
            LayerKind::Color => None,
        }
    }

    pub fn mappings(&self) -> Option<&[String]> {
        match &self.kind {
            LayerKind::Segmentation { mappings, .. } => mappings.as_deref(),
            LayerKind::Color => None,
        }
    }

    /// Scala `resolutions` (mags of the mag locators, in order).
    pub fn resolutions(&self) -> Vec<Vec3Int> {
        self.mags.iter().map(|m| m.mag).collect()
    }

    pub fn num_channels(&self) -> u32 {
        self.element_class.num_channels()
    }

    pub fn bytes_per_element(&self) -> usize {
        self.element_class.bytes_per_element()
    }

    pub fn contains_mag(&self, mag: Vec3Int) -> bool {
        self.mags.iter().any(|m| m.mag == mag)
    }

    /// Scala `sortedMags` (stable sort by max dimension).
    pub fn sorted_mags(&self) -> Vec<Vec3Int> {
        let mut mags = self.resolutions();
        mags.sort_by_key(|m| m.max_dim());
        mags
    }

    pub fn finest_mag(&self) -> Option<Vec3Int> {
        self.sorted_mags().first().copied()
    }

    pub fn all_attachments(&self) -> Vec<&LayerAttachment> {
        self.attachments
            .as_ref()
            .map(DataLayerAttachments::all_attachments)
            .unwrap_or_default()
    }

    /// Scala `allExplicitPaths`: mag paths, then attachment paths.
    pub fn all_explicit_paths(&self) -> Vec<&UPath> {
        self.mags
            .iter()
            .filter_map(|m| m.path.as_ref())
            .chain(self.all_attachments().into_iter().map(|a| &a.path))
            .collect()
    }

    /// Scala `withMergedAttachments`.
    pub fn with_merged_attachments(&self, attachments: &DataLayerAttachments) -> Self {
        let merged = match &self.attachments {
            Some(own) => own.merge_with_precedence(attachments),
            None => attachments.clone(),
        };
        Self {
            attachments: Some(merged),
            ..self.clone()
        }
    }

    /// Scala `withAttachments`.
    pub fn with_attachments(&self, attachments: DataLayerAttachments) -> Self {
        Self {
            attachments: Some(attachments),
            ..self.clone()
        }
    }

    /// Scala `relativizePaths`.
    pub fn relativize_paths(&self, data_source_path: &UPath) -> Self {
        Self {
            mags: self
                .mags
                .iter()
                .map(|m| MagLocator {
                    path: m.path.as_ref().map(|p| p.relativized_in(data_source_path)),
                    ..m.clone()
                })
                .collect(),
            attachments: self
                .attachments
                .as_ref()
                .map(|a| a.relativized_in(data_source_path)),
            ..self.clone()
        }
    }

    /// Scala `staticLayerFormat.reads` + `StaticColorLayer`/`StaticSegmentationLayer` reads.
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let category = match json.get("category") {
            Some(value) => LayerCategory::from_json(value).map_err(|e| e.at_key("category"))?,
            None => return Err(JsError::new("error.path.missing").at_key("category")),
        };
        let mags = match lookup(json, "mags", |v| read_list(v, MagLocator::from_json)) {
            Ok(mags) => mags,
            Err(_) => lookup(json, "wkwResolutions", |v| {
                read_list(v, MagLocator::from_wkw_resolution_json)
            })
            .map_err(|_| JsError::new("Either 'mags' or 'wkwResolutions' must be provided"))?,
        };
        let data_format = lookup(json, "dataFormat", DataFormat::from_json)?;
        let name = lookup(json, "name", read_string)?;
        let kind = match category {
            LayerCategory::Color => LayerKind::Color,
            LayerCategory::Segmentation => LayerKind::Segmentation {
                largest_segment_id: lookup_opt(json, "largestSegmentId", read_unsigned_long)?,
                mappings: lookup_opt(json, "mappings", read_string_set)?,
            },
        };
        let bounding_box = lookup(json, "boundingBox", BoundingBox::from_json)?;
        let element_class = lookup(json, "elementClass", ElementClass::from_json)?;
        let default_view_configuration = lookup_opt(json, "defaultViewConfiguration", read_object)?;
        let admin_view_configuration = lookup_opt(json, "adminViewConfiguration", read_object)?;
        let coordinate_transformations = lookup_opt(json, "coordinateTransformations", |v| {
            read_list(v, CoordinateTransformation::from_json)
        })?;
        let additional_axes = lookup_opt(json, "additionalAxes", |v| {
            read_list(v, AdditionalAxis::from_json)
        })?;
        let attachments = lookup_opt(json, "attachments", DataLayerAttachments::from_json)?;
        Ok(Self {
            name,
            data_format,
            bounding_box,
            element_class,
            mags,
            default_view_configuration: default_view_configuration.filter(|c| !c.is_empty()),
            admin_view_configuration: admin_view_configuration.filter(|c| !c.is_empty()),
            coordinate_transformations: coordinate_transformations.filter(|t| !t.is_empty()),
            additional_axes,
            attachments,
            kind,
        })
    }
}

impl StaticLayer {
    /// Play writes (`staticLayerFormat.writes`). With `on_disk`, the `DataSourceToDiskWriter`
    /// transformations are applied: no `resolutions`, `largestSegmentId` ≤ 2^53-1 as a plain
    /// number, and both rules applied recursively inside the pass-through view configurations.
    fn serialize_with<S: Serializer>(
        &self,
        serializer: S,
        on_disk: bool,
    ) -> Result<S::Ok, S::Error> {
        let view_config = |config: &ViewConfiguration| {
            let value = Value::Object(config.clone());
            if on_disk {
                patch_largest_segment_id(remove_key_recursively(value, "resolutions"))
            } else {
                value
            }
        };
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("category", &self.category())?;
        map.serialize_entry("name", &self.name)?;
        map.serialize_entry("dataFormat", &self.data_format)?;
        map.serialize_entry("boundingBox", &self.bounding_box)?;
        map.serialize_entry("elementClass", &self.element_class)?;
        map.serialize_entry("mags", &self.mags)?;
        if let Some(config) = &self.default_view_configuration {
            map.serialize_entry("defaultViewConfiguration", &PlayValue(&view_config(config)))?;
        }
        if let Some(config) = &self.admin_view_configuration {
            map.serialize_entry("adminViewConfiguration", &PlayValue(&view_config(config)))?;
        }
        if let Some(transformations) = &self.coordinate_transformations {
            map.serialize_entry("coordinateTransformations", transformations)?;
        }
        if let Some(axes) = &self.additional_axes {
            map.serialize_entry("additionalAxes", axes)?;
        }
        if let Some(attachments) = &self.attachments {
            map.serialize_entry("attachments", attachments)?;
        }
        if let LayerKind::Segmentation {
            largest_segment_id,
            mappings,
        } = &self.kind
        {
            if let Some(mappings) = mappings {
                map.serialize_entry("mappings", mappings)?;
            }
            if let Some(id) = largest_segment_id {
                let envelope = unsigned_long_envelope(*id);
                let value = if on_disk {
                    downgrade_to_plain_number_if_safe(envelope)
                } else {
                    envelope
                };
                map.serialize_entry("largestSegmentId", &value)?;
            }
        }
        if !on_disk {
            map.serialize_entry("resolutions", &self.resolutions())?;
        }
        map.serialize_entry("numChannels", &self.num_channels())?;
        map.end()
    }
}

impl Serialize for StaticLayer {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.serialize_with(serializer, false)
    }
}

/// A layer list serialized in the disk-writer form.
struct OnDiskLayers<'a>(&'a [StaticLayer]);

impl Serialize for OnDiskLayers<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        struct OnDiskLayer<'a>(&'a StaticLayer);
        impl Serialize for OnDiskLayer<'_> {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                self.0.serialize_with(serializer, true)
            }
        }
        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for layer in self.0 {
            seq.serialize_element(&OnDiskLayer(layer))?;
        }
        seq.end()
    }
}

/// Scala `UsableDataSource`.
#[derive(Debug, Clone, PartialEq)]
pub struct UsableDataSource {
    pub id: DataSourceId,
    pub data_layers: Vec<StaticLayer>,
    pub scale: VoxelSize,
    pub default_view_configuration: Option<ViewConfiguration>,
    pub status_opt: Option<String>,
}

impl UsableDataSource {
    /// Scala derived `UsableDataSource` reads (errors accumulated per field).
    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let id = fields.req("id", DataSourceId::from_json);
        let data_layers = fields.req("dataLayers", |v| read_list(v, StaticLayer::from_json));
        let scale = fields.req("scale", VoxelSize::from_json);
        let default_view_configuration = fields.opt("defaultViewConfiguration", read_object);
        let status_opt = fields.opt("statusOpt", read_string);
        fields.finish()?;
        Ok(Self {
            id: id?,
            data_layers: data_layers?,
            scale: scale?,
            default_view_configuration: default_view_configuration?,
            status_opt: status_opt?,
        })
    }

    pub fn get_data_layer(&self, name: &str) -> Option<&StaticLayer> {
        self.data_layers.iter().find(|l| l.name == name)
    }

    /// Scala `boundingBox`: union of all layer bounding boxes.
    pub fn bounding_box(&self) -> BoundingBox {
        BoundingBox::union_all(self.data_layers.iter().map(|l| &l.bounding_box))
    }

    pub fn center(&self) -> Vec3Int {
        self.bounding_box().center()
    }

    pub fn segmentation_layers(&self) -> impl Iterator<Item = &StaticLayer> {
        self.data_layers.iter().filter(|l| l.is_segmentation())
    }

    pub fn additional_axes_union(&self) -> Option<Vec<AdditionalAxis>> {
        AdditionalAxis::merge(
            self.data_layers
                .iter()
                .map(|l| l.additional_axes.as_deref()),
        )
    }

    pub fn all_explicit_paths(&self) -> Vec<&UPath> {
        self.data_layers
            .iter()
            .flat_map(StaticLayer::all_explicit_paths)
            .collect()
    }

    pub fn to_unusable_with_status(&self, status: impl Into<String>) -> UnusableDataSource {
        UnusableDataSource {
            id: self.id.clone(),
            data_layers: Some(self.data_layers.clone()),
            status: status.into(),
            scale: Some(self.scale),
            existing_data_source_properties: None,
        }
    }

    /// Scala `DataSourceValidation.validateDataSourceGetErrors`.
    pub fn validation_errors(&self) -> Vec<&'static str> {
        let mags_sorted: Vec<Vec<Vec3Int>> = self
            .data_layers
            .iter()
            .map(StaticLayer::sorted_mags)
            .collect();
        let dimension_sorted = |component: fn(&Vec3Int) -> i32| {
            mags_sorted.iter().all(|mags| {
                mags.windows(2)
                    .all(|pair| component(&pair[0]) <= component(&pair[1]))
            })
        };
        let names: Vec<&str> = self.data_layers.iter().map(|l| l.name.as_str()).collect();
        let distinct_names: std::collections::HashSet<&str> = names.iter().copied().collect();
        let checks = [
            (
                self.scale.factor.is_strictly_positive(),
                "Voxel size (scale) is negative in at least one dimension.",
            ),
            (
                dimension_sorted(|m| m.x) && dimension_sorted(|m| m.y) && dimension_sorted(|m| m.z),
                "Mags do not monotonically increase in all dimensions.",
            ),
            (
                mags_sorted.iter().all(|mags| {
                    let distinct: std::collections::HashSet<&Vec3Int> = mags.iter().collect();
                    distinct.len() == mags.len()
                }),
                "There are duplicate mags in a layer.",
            ),
            (!self.data_layers.is_empty(), "No layers."),
            (
                self.data_layers.iter().all(|l| !l.bounding_box.is_empty()),
                "Empty bounding box in a layer.",
            ),
            (
                self.segmentation_layers()
                    .all(|l| l.element_class.is_segmentation_element_class()),
                "Invalid element class for a segmentation layer.",
            ),
            (
                self.segmentation_layers().all(|l| {
                    l.element_class
                        .largest_segment_id_is_in_range(l.largest_segment_id())
                }),
                "Largest segment id exceeds range (must be nonnegative and within the element class's value range).",
            ),
            (
                distinct_names.len() == names.len(),
                "Layer names must be unique. At least two layers have the same name.",
            ),
            (
                names.iter().all(|n| !n.contains('/')),
                "Layer names must not contain forward slash.",
            ),
            (
                names.iter().all(|n| !n.starts_with('.')),
                "Layer names must not start with dot.",
            ),
            (
                self.data_layers
                    .iter()
                    .filter_map(|l| l.attachments.as_ref())
                    .all(|a| !a.contains_duplicate_names()),
                "Layer attachments must have unique names in their respective category.",
            ),
        ];
        checks
            .into_iter()
            .filter(|(ok, _)| !ok)
            .map(|(_, message)| message)
            .collect()
    }

    /// Scala `assertValidDataSource` error payload: `[{"error": msg}, ...]` (or `None` if valid).
    pub fn validation_error_json(&self) -> Option<Value> {
        let errors = self.validation_errors();
        (!errors.is_empty()).then(|| {
            Value::Array(
                errors
                    .into_iter()
                    .map(|e| serde_json::json!({"error": e}))
                    .collect(),
            )
        })
    }

    /// Scala `DataSourceToDiskWriter` JSON (after path relativization by the caller):
    /// `Json.toJson`, all `resolutions` keys removed recursively, every `largestSegmentId`
    /// envelope ≤ 2^53-1 downgraded to a plain number.
    ///
    /// Note: a [`Value`] object is key-sorted (serde_json without `preserve_order`); use
    /// [`Self::to_properties_file_content`] for the file bytes.
    pub fn to_properties_json(&self) -> Value {
        serde_json::to_value(OnDiskDataSource(self)).unwrap_or(Value::Null)
    }

    /// The `datasource-properties.json` content written by Scala `JsonHelper.writeToFile`
    /// (Play `Json.prettyPrint`, Jackson style, no trailing newline), in Play's key order.
    pub fn to_properties_file_content(&self) -> String {
        super::json::pretty_print_serialize(&OnDiskDataSource(self))
    }

    /// Scala `DataSourceMirrorService.writeMirrorProperties`: regular `Json.toJson` with all
    /// `resolutions` keys removed, pretty-printed (no `largestSegmentId` downgrade).
    pub fn to_mirror_properties_file_content(&self) -> String {
        let value = serde_json::to_value(self).unwrap_or(Value::Null);
        super::json::pretty_print_serialize(&remove_key_recursively(value, "resolutions"))
    }
}

fn remove_key_recursively(value: Value, key: &str) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .filter(|(k, _)| k != key)
                .map(|(k, v)| (k, remove_key_recursively(v, key)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|v| remove_key_recursively(v, key))
                .collect(),
        ),
        other => other,
    }
}

/// Scala `patchKeyRecursively(_, "largestSegmentId")(UnsignedLong.downgradeToPlainNumberIfSafe)`.
pub(crate) fn patch_largest_segment_id(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(k, v)| {
                    if k == "largestSegmentId" {
                        let patched = downgrade_to_plain_number_if_safe(v);
                        (k, patched)
                    } else {
                        (k, patch_largest_segment_id(v))
                    }
                })
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.into_iter().map(patch_largest_segment_id).collect())
        }
        other => other,
    }
}

/// Scala `UnsignedLong.downgradeToPlainNumberIfSafe`.
pub fn downgrade_to_plain_number_if_safe(json: Value) -> Value {
    let is_envelope = json.get("customJsonEncoding").and_then(Value::as_str) == Some("bigint");
    if !is_envelope {
        return json;
    }
    match json
        .get("value")
        .and_then(Value::as_str)
        .and_then(parse_unsigned_long)
    {
        Some(value) if value <= JS_MAX_SAFE_INTEGER => Value::from(value),
        _ => json,
    }
}

impl UsableDataSource {
    fn serialize_with<S: Serializer>(
        &self,
        serializer: S,
        on_disk: bool,
    ) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &self.id)?;
        if on_disk {
            map.serialize_entry("dataLayers", &OnDiskLayers(&self.data_layers))?;
        } else {
            map.serialize_entry("dataLayers", &self.data_layers)?;
        }
        map.serialize_entry("scale", &self.scale)?;
        if let Some(config) = &self.default_view_configuration {
            let mut value = Value::Object(config.clone());
            if on_disk {
                value = patch_largest_segment_id(remove_key_recursively(value, "resolutions"));
            }
            map.serialize_entry("defaultViewConfiguration", &PlayValue(&value))?;
        }
        if let Some(status) = &self.status_opt {
            map.serialize_entry("statusOpt", status)?;
        }
        map.end()
    }
}

impl Serialize for UsableDataSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.serialize_with(serializer, false)
    }
}

/// [`UsableDataSource`] serialized in the `DataSourceToDiskWriter` form (see
/// [`UsableDataSource::to_properties_file_content`]).
pub struct OnDiskDataSource<'a>(pub &'a UsableDataSource);

impl Serialize for OnDiskDataSource<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize_with(serializer, true)
    }
}

/// Scala `UnusableDataSource`.
#[derive(Debug, Clone, PartialEq)]
pub struct UnusableDataSource {
    pub id: DataSourceId,
    pub data_layers: Option<Vec<StaticLayer>>,
    pub status: String,
    pub scale: Option<VoxelSize>,
    pub existing_data_source_properties: Option<Value>,
}

impl UnusableDataSource {
    pub fn new(id: DataSourceId, status: impl Into<String>) -> Self {
        Self {
            id,
            data_layers: None,
            status: status.into(),
            scale: None,
            existing_data_source_properties: None,
        }
    }

    pub fn from_json(json: &Value) -> JsResult<Self> {
        let mut fields = Fields::new(json);
        let id = fields.req("id", DataSourceId::from_json);
        let data_layers = fields.opt("dataLayers", |v| read_list(v, StaticLayer::from_json));
        let status = fields.req("status", read_string);
        let scale = fields.opt("scale", VoxelSize::from_json);
        let existing = fields.opt("existingDataSourceProperties", read_any);
        fields.finish()?;
        Ok(Self {
            id: id?,
            data_layers: data_layers?,
            status: status?,
            scale: scale?,
            existing_data_source_properties: existing?,
        })
    }
}

impl Serialize for UnusableDataSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &self.id)?;
        if let Some(layers) = &self.data_layers {
            map.serialize_entry("dataLayers", layers)?;
        }
        map.serialize_entry("status", &self.status)?;
        if let Some(scale) = &self.scale {
            map.serialize_entry("scale", scale)?;
        }
        if let Some(existing) = &self.existing_data_source_properties {
            map.serialize_entry("existingDataSourceProperties", &PlayValue(existing))?;
        }
        map.end()
    }
}

/// Scala `DataSource` (reads `UnusableDataSource` first, then `UsableDataSource`).
#[derive(Debug, Clone, PartialEq)]
pub enum DataSource {
    Usable(UsableDataSource),
    Unusable(UnusableDataSource),
}

impl DataSource {
    pub fn from_json(json: &Value) -> JsResult<Self> {
        match UnusableDataSource::from_json(json) {
            Ok(unusable) => Ok(Self::Unusable(unusable)),
            Err(_) => UsableDataSource::from_json(json).map(Self::Usable),
        }
    }

    pub fn id(&self) -> &DataSourceId {
        match self {
            Self::Usable(ds) => &ds.id,
            Self::Unusable(ds) => &ds.id,
        }
    }

    pub fn with_updated_id(self, id: DataSourceId) -> Self {
        match self {
            Self::Usable(ds) => Self::Usable(UsableDataSource { id, ..ds }),
            Self::Unusable(ds) => Self::Unusable(UnusableDataSource { id, ..ds }),
        }
    }

    pub fn to_usable(&self) -> Option<&UsableDataSource> {
        match self {
            Self::Usable(ds) => Some(ds),
            Self::Unusable(_) => None,
        }
    }

    pub fn is_usable(&self) -> bool {
        matches!(self, Self::Usable(_))
    }

    pub fn voxel_size_opt(&self) -> Option<VoxelSize> {
        match self {
            Self::Usable(ds) => Some(ds.scale),
            Self::Unusable(ds) => ds.scale,
        }
    }

    pub fn status_opt(&self) -> Option<&str> {
        match self {
            Self::Usable(ds) => ds.status_opt.as_deref(),
            Self::Unusable(ds) => Some(&ds.status),
        }
    }

    pub fn default_view_configuration(&self) -> Option<&ViewConfiguration> {
        match self {
            Self::Usable(ds) => ds.default_view_configuration.as_ref(),
            Self::Unusable(_) => None,
        }
    }

    pub fn all_layers(&self) -> &[StaticLayer] {
        match self {
            Self::Usable(ds) => &ds.data_layers,
            Self::Unusable(ds) => ds.data_layers.as_deref().unwrap_or_default(),
        }
    }
}

impl Serialize for DataSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Usable(ds) => ds.serialize(serializer),
            Self::Unusable(ds) => ds.serialize(serializer),
        }
    }
}

deserialize_via_from_json!(
    DataSourceId,
    VoxelSize,
    AxisOrder,
    LegacyDataVaultCredential,
    MagLocator,
    AdditionalAxis,
    ThinPlateSplineCorrespondences,
    CoordinateTransformation,
    LayerAttachment,
    DataLayerAttachments,
    StaticLayer,
    UsableDataSource,
    UnusableDataSource,
    DataSource,
);
