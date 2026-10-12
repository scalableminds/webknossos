//! Scala `models.annotation.AnnotationSource` / `AnnotationLayer` (answer of WEBKNOSSOS
//! `GET /api/annotations/source/:accessToken`).
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::error::{DsError, DsResult};

/// Scala `AnnotationLayerType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum AnnotationLayerType {
    Skeleton,
    Volume,
}

/// Scala `AnnotationLayer`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationLayer {
    pub tracing_id: String,
    pub typ: AnnotationLayerType,
    pub name: String,
    pub stats: Map<String, Value>,
}

/// Scala `AnnotationSource`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSource {
    pub id: String,
    pub annotation_layers: Vec<AnnotationLayer>,
    pub dataset_directory_name: String,
    pub dataset_id: String,
    pub organization_id: String,
    pub data_store_url: String,
    pub tracing_store_url: String,
    pub access_via_private_link: bool,
}

impl AnnotationSource {
    pub fn from_json(value: Value) -> DsResult<Self> {
        serde_json::from_value(value)
            .map_err(|e| DsError::failure(format!("JSON validation failed: {e}")))
    }

    /// Scala `getAnnotationLayer`.
    pub fn annotation_layer(&self, name: &str) -> Option<&AnnotationLayer> {
        self.annotation_layers.iter().find(|l| l.name == name)
    }

    pub fn volume_layers(&self) -> impl Iterator<Item = &AnnotationLayer> {
        self.annotation_layers
            .iter()
            .filter(|l| l.typ == AnnotationLayerType::Volume)
    }
}
