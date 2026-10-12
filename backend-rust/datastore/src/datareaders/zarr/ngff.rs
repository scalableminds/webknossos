//! Scala `zarr/NgffMetadata`, `NgffMetadataV0_5` and `SharedNgffMetadataAttributes` (OME-NGFF
//! `.zattrs` / `zarr.json` attributes). Play `Json.format` semantics: fields with Scala defaults
//! are still required on read, `Option` fields may be missing or null and are omitted on write.

use serde::{Deserialize, Serialize};

use crate::error::{DsError, DsResult};
use crate::models::{LengthUnit, Vec3Double, Vec3Int, VoxelSize};

pub const FILENAME_DOT_ZGROUP: &str = ".zgroup";
pub const FILENAME_DOT_ZATTRS: &str = ".zattrs";
pub const LABEL_PATH: &str = "labels/.zattrs";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffGroupHeader {
    pub zarr_format: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffCoordinateTransformation {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation: Option<Vec<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NgffDataset {
    pub path: String,
    pub coordinate_transformations: Vec<NgffCoordinateTransformation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NgffAxis {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

impl NgffAxis {
    pub fn new(name: impl Into<String>, kind: impl Into<String>, unit: Option<String>) -> Self {
        Self {
            name: name.into(),
            kind: kind.into(),
            unit,
        }
    }

    /// Scala `lengthUnit`: `Ok(None)` is Scala `Empty` (unknown unit string).
    pub fn length_unit(&self) -> DsResult<Option<LengthUnit>> {
        if self.kind != "space" {
            return Err(DsError::failure(format!(
                "Could not convert NGFF unit {} of type {} to LengthUnit",
                self.name, self.kind
            )));
        }
        Ok(match self.unit.as_deref() {
            None | Some("") => Some(LengthUnit::Nanometer),
            Some(unit) => LengthUnit::from_name(unit),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffChannelWindow {
    pub min: f64,
    pub max: f64,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffChannelAttributes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<NgffChannelWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inverted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffOmeroMetadata {
    pub channels: Vec<NgffChannelAttributes>,
}

/// Scala `NgffMultiscalesItem` (v0.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffMultiscalesItem {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub axes: Vec<NgffAxis>,
    pub datasets: Vec<NgffDataset>,
}

/// Scala `NgffMetadata` (v0.4 `.zattrs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffMetadata {
    pub multiscales: Vec<NgffMultiscalesItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omero: Option<NgffOmeroMetadata>,
}

/// Scala `NgffMultiscalesItemV0_5` (no per-item version).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffMultiscalesItemV0_5 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub axes: Vec<NgffAxis>,
    pub datasets: Vec<NgffDataset>,
}

impl NgffMultiscalesItemV0_5 {
    /// Scala `asV0_4` (version "0.5").
    pub fn as_v0_4(&self) -> NgffMultiscalesItem {
        NgffMultiscalesItem {
            version: "0.5".into(),
            name: self.name.clone(),
            axes: self.axes.clone(),
            datasets: self.datasets.clone(),
        }
    }
}

/// Scala `NgffMetadataV0_5`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffMetadataV0_5 {
    pub version: String,
    pub multiscales: Vec<NgffMultiscalesItemV0_5>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omero: Option<NgffOmeroMetadata>,
}

/// Scala `NgffLabelsGroup`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NgffLabelsGroup {
    pub labels: Vec<String>,
}

fn datasets_for_mags(voxel_size: &VoxelSize, mags: &[Vec3Int]) -> Vec<NgffDataset> {
    mags.iter()
        .map(|mag| {
            let scaled = Vec3Double::new(
                voxel_size.factor.x * f64::from(mag.x),
                voxel_size.factor.y * f64::from(mag.y),
                voxel_size.factor.z * f64::from(mag.z),
            );
            NgffDataset {
                path: mag.to_mag_literal(true),
                coordinate_transformations: vec![NgffCoordinateTransformation {
                    kind: "scale".into(),
                    scale: Some(vec![1.0, scaled.x, scaled.y, scaled.z]),
                    translation: None,
                }],
            }
        })
        .collect()
}

fn space_axis(name: &str, unit: &str) -> NgffAxis {
    NgffAxis::new(name, "space", Some(unit.to_string()))
}

impl NgffMetadata {
    /// Scala `NgffMetadata.fromNameVoxelSizeAndMags`.
    pub fn from_name_voxel_size_and_mags(
        data_layer_name: &str,
        voxel_size: &VoxelSize,
        mags: &[Vec3Int],
    ) -> Self {
        let unit = voxel_size.unit.as_str();
        Self {
            multiscales: vec![NgffMultiscalesItem {
                version: "0.4".into(),
                name: Some(data_layer_name.to_string()),
                axes: vec![
                    NgffAxis::new("c", "channel", None),
                    space_axis("x", unit),
                    space_axis("y", unit),
                    space_axis("z", unit),
                ],
                datasets: datasets_for_mags(voxel_size, mags),
            }],
            omero: None,
        }
    }
}

impl NgffMetadataV0_5 {
    /// Scala `NgffMetadataV0_5.fromNameVoxelSizeAndMags` (additional axes become `t0`, `t1`, …
    /// space axes, as in Scala).
    pub fn from_name_voxel_size_and_mags(
        data_layer_name: &str,
        voxel_size: &VoxelSize,
        mags: &[Vec3Int],
        additional_axes_count: usize,
        version: &str,
    ) -> Self {
        let unit = voxel_size.unit.as_str();
        let mut axes = vec![NgffAxis::new("c", "channel", None)];
        axes.extend((0..additional_axes_count).map(|i| space_axis(&format!("t{i}"), unit)));
        axes.extend([
            space_axis("x", unit),
            space_axis("y", unit),
            space_axis("z", unit),
        ]);
        Self {
            version: version.to_string(),
            multiscales: vec![NgffMultiscalesItemV0_5 {
                name: Some(data_layer_name.to_string()),
                axes,
                datasets: datasets_for_mags(voxel_size, mags),
            }],
            omero: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_and_writes_v0_4() {
        let json = json!({
            "multiscales": [{
                "version": "0.4", "name": "img",
                "axes": [{"name": "c", "type": "channel"}, {"name": "z", "type": "space", "unit": "micrometer"},
                         {"name": "y", "type": "space", "unit": "µm"}, {"name": "x", "type": "space"}],
                "datasets": [{"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 0.5, 0.5, 0.5]}]}]
            }],
            "omero": {"channels": [{"color": "FF0000", "window": {"min": 0, "max": 255, "start": 0, "end": 100}}]}
        });
        let metadata: NgffMetadata = serde_json::from_value(json).unwrap();
        let axes = &metadata.multiscales[0].axes;
        assert!(axes[0].length_unit().is_err());
        assert_eq!(axes[1].length_unit().unwrap(), Some(LengthUnit::Micrometer));
        assert_eq!(axes[3].length_unit().unwrap(), Some(LengthUnit::Nanometer));
        // fields with Scala defaults are required (plain Json.format)
        assert!(serde_json::from_value::<NgffMultiscalesItem>(json!({"datasets": []})).is_err());
        let v05: NgffMetadataV0_5 = serde_json::from_value(json!({
            "version": "0.5",
            "multiscales": [{"axes": [], "datasets": []}]
        }))
        .unwrap();
        assert_eq!(v05.multiscales[0].as_v0_4().version, "0.5");
    }

    #[test]
    fn generated_metadata_matches_scala_shape() {
        let voxel_size =
            VoxelSize::from_factor_with_default_unit(Vec3Double::new(11.0, 11.0, 24.0));
        let metadata = NgffMetadata::from_name_voxel_size_and_mags(
            "color",
            &voxel_size,
            &[Vec3Int::new(1, 1, 1), Vec3Int::new(2, 2, 1)],
        );
        assert_eq!(
            serde_json::to_value(&metadata).unwrap(),
            json!({"multiscales": [{"version": "0.4", "name": "color", "axes": [
                {"name": "c", "type": "channel"},
                {"name": "x", "type": "space", "unit": "nanometer"},
                {"name": "y", "type": "space", "unit": "nanometer"},
                {"name": "z", "type": "space", "unit": "nanometer"}],
              "datasets": [
                {"path": "1", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 11.0, 11.0, 24.0]}]},
                {"path": "2-2-1", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 22.0, 22.0, 24.0]}]}]}]})
        );
        let v05 =
            NgffMetadataV0_5::from_name_voxel_size_and_mags("seg", &voxel_size, &[], 1, "0.5");
        let names: Vec<&str> = v05.multiscales[0]
            .axes
            .iter()
            .map(|a| a.name.as_str())
            .collect();
        assert_eq!(names, ["c", "t0", "x", "y", "z"]);
    }
}
