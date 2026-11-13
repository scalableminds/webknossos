//! Annotation types and identifiers, the access context, layers and provided annotations.
use std::{fmt, hash::Hash, str::FromStr};

use chrono::{DateTime, Utc};

use super::error::ProviderError;
use crate::{
    annotation::access::AnnotationMetadata,
    auth::AuthUser,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    util::id::ObjectId,
};

/// `models.annotation.AnnotationType`; parsing is exact and case-sensitive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnnotationType {
    Task,
    View,
    Explorational,
    TracingBase,
    Orphan,
    CompoundTask,
    CompoundProject,
    CompoundTaskType,
}

impl AnnotationType {
    pub const ALL: [Self; 8] = [
        Self::Task,
        Self::View,
        Self::Explorational,
        Self::TracingBase,
        Self::Orphan,
        Self::CompoundTask,
        Self::CompoundProject,
        Self::CompoundTaskType,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Task => "Task",
            Self::View => "View",
            Self::Explorational => "Explorational",
            Self::TracingBase => "TracingBase",
            Self::Orphan => "Orphan",
            Self::CompoundTask => "CompoundTask",
            Self::CompoundProject => "CompoundProject",
            Self::CompoundTaskType => "CompoundTaskType",
        }
    }

    /// The three types served by a compound handler; all others select the
    /// saved handler (AnnotationInformationHandlerSelector default).
    pub fn is_compound(self) -> bool {
        matches!(
            self,
            Self::CompoundTask | Self::CompoundProject | Self::CompoundTaskType
        )
    }
}

impl fmt::Display for AnnotationType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AnnotationType {
    type Err = ProviderError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|typ| typ.as_str() == value)
            .ok_or_else(|| ProviderError::InvalidType(value.to_owned()))
    }
}

/// `AnnotationIdentifier(annotationType, identifier)`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AnnotationIdentifier {
    pub annotation_type: AnnotationType,
    /// Annotation ID for saved types, task/project/task-type ID for compounds.
    pub identifier: ObjectId,
}

impl AnnotationIdentifier {
    /// AnnotationIdentifier.parse; the ID was already bound by the path binder.
    pub fn parse(typ: &str, id: &ObjectId) -> Result<Self, ProviderError> {
        Ok(Self {
            annotation_type: typ.parse()?,
            identifier: id.clone(),
        })
    }

    /// `toUniqueString`, the AnnotationStore cache key `<type>__<id>`.
    pub fn to_unique_string(&self) -> String {
        format!("{}__{}", self.annotation_type, self.identifier)
    }
}

/// Database access context of the provider call (Scala `DBAccessContext`).
#[derive(Clone, Copy)]
pub struct AccessContext<'a> {
    /// Requesting user (`userOpt`), also the owner of fresh compound merges.
    pub requester: Option<&'a AuthUser>,
    /// GlobalAccessContext: skip DAO read predicates.
    pub global: bool,
}

impl<'a> AccessContext<'a> {
    pub fn requester(requester: Option<&'a AuthUser>) -> Self {
        Self {
            requester,
            global: false,
        }
    }
    pub fn global(requester: Option<&'a AuthUser>) -> Self {
        Self {
            requester,
            global: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnnotationLayerType {
    Skeleton,
    Volume,
}

impl AnnotationLayerType {
    /// The `webknossos.ANNOTATION_LAYER_TYPE` value, also the JSON `typ`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Skeleton => "Skeleton",
            Self::Volume => "Volume",
        }
    }
}
impl From<AnnotationLayerTypeProto> for AnnotationLayerType {
    fn from(typ: AnnotationLayerTypeProto) -> Self {
        match typ {
            AnnotationLayerTypeProto::Skeleton => Self::Skeleton,
            AnnotationLayerTypeProto::Volume => Self::Volume,
        }
    }
}
impl From<AnnotationLayerType> for AnnotationLayerTypeProto {
    fn from(typ: AnnotationLayerType) -> Self {
        match typ {
            AnnotationLayerType::Skeleton => Self::Skeleton,
            AnnotationLayerType::Volume => Self::Volume,
        }
    }
}

/// AnnotationLayer.fromProto (statistics are `unknown` for merged layers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationLayer {
    pub tracing_id: String,
    pub typ: AnnotationLayerType,
    pub name: String,
}

/// AnnotationLayer.fromProto for every layer (statistics `unknown` = `{}`).
pub(crate) fn layers_from_proto(proto: &AnnotationProto) -> Vec<AnnotationLayer> {
    proto
        .annotation_layers
        .iter()
        .map(|layer| AnnotationLayer {
            tracing_id: layer.tracing_id.clone(),
            typ: layer.typ().into(),
            name: layer.name.clone(),
        })
        .collect()
}

/// Synthetic annotation produced by a compound handler (AnnotationMerger.mergeN):
/// never persisted, cached per `<type>__<id>` for 60 minutes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompoundAnnotation {
    /// The task/project/task-type ID from the path.
    pub id: ObjectId,
    pub dataset_id: ObjectId,
    /// The first requester that triggered the merge (not updated on cache hits).
    pub owner_id: ObjectId,
    pub annotation_type: AnnotationType,
    pub layers: Vec<AnnotationLayer>,
    pub created: DateTime<Utc>,
}

impl CompoundAnnotation {
    /// Build the synthetic Annotation from the tracing-store merge result.
    /// Remaining fields use Annotation defaults: no task, empty name and
    /// description, Internal visibility, Active state, OwnerOnly collaboration,
    /// unlocked, no tags, no tracing time, created == modified.
    pub fn from_merge(
        identifier: &AnnotationIdentifier,
        dataset_id: ObjectId,
        owner_id: ObjectId,
        merged: &AnnotationProto,
    ) -> Self {
        let layers = layers_from_proto(merged);
        Self {
            id: identifier.identifier.clone(),
            dataset_id,
            owner_id,
            annotation_type: identifier.annotation_type,
            layers,
            created: Utc::now(),
        }
    }
}

/// Result of provideAnnotation: a live saved row or a synthetic compound.
#[derive(Debug)]
pub enum ProvidedAnnotation {
    Saved(Box<AnnotationMetadata>),
    Compound(CompoundAnnotation),
}

impl ProvidedAnnotation {
    pub fn id(&self) -> &ObjectId {
        match self {
            Self::Saved(saved) => &saved.id,
            Self::Compound(compound) => &compound.id,
        }
    }
    pub fn owner_id(&self) -> &ObjectId {
        match self {
            Self::Saved(saved) => &saved.owner_id,
            Self::Compound(compound) => &compound.owner_id,
        }
    }
    pub fn dataset_id(&self) -> &ObjectId {
        match self {
            Self::Saved(saved) => &saved.dataset_id,
            Self::Compound(compound) => &compound.dataset_id,
        }
    }
    /// The actual (stored or compound) type — NOT the requested path type.
    /// The database enum is a subset of AnnotationType, so `None` never
    /// occurs for valid rows; it fails closed in type comparisons.
    pub fn annotation_type(&self) -> Option<AnnotationType> {
        match self {
            Self::Saved(saved) => saved.annotation_type.parse().ok(),
            Self::Compound(compound) => Some(compound.annotation_type),
        }
    }
    pub fn visibility(&self) -> &str {
        match self {
            Self::Saved(saved) => &saved.visibility,
            Self::Compound(_) => "Internal",
        }
    }
    pub fn saved(&self) -> Option<&AnnotationMetadata> {
        match self {
            Self::Saved(saved) => Some(saved),
            Self::Compound(_) => None,
        }
    }
    pub fn compound(&self) -> Option<&CompoundAnnotation> {
        match self {
            Self::Saved(_) => None,
            Self::Compound(compound) => Some(compound),
        }
    }
}
