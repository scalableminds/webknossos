//! Scala `AnnotationInformationProvider` / `AnnotationStore`: exact
//! `AnnotationType` parsing, `AnnotationIdentifier`, the saved handler, the
//! three compound handlers (`TaskInformationHandler`,
//! `ProjectInformationHandler`, `TaskTypeInformationHandler`) with their
//! restrictions, `AnnotationMerger.mergeN`, the 60-minute `<type>__<id>`
//! compound cache and the shared `AnnotationDataSourceTemporaryStore`.
//!
//! Compound types interpret the path ID as a task/project/task-type ID. A
//! cache miss runs the handler (parent DAO access, finished Task
//! annotations, same-dataset check, data-source registration, task bounding
//! boxes, tracing-store merge into its temporary store); the synthetic
//! annotation is cached and never persisted. Cache hits return the stored
//! annotation unchanged (the first requester stays the owner).
//!
//! Fox semantics are modelled by [`ProviderError`]: handler failures carry
//! the exact Scala message plus its `?~>` chain, and `provide` wraps every
//! compound failure as `Annotation could not be found or accessed.` exactly
//! like `provideAnnotation(typ, id, userOpt)`. Only an upstream tracing-store
//! HTTP status survives as a status (Scala `ParamFailure`); every other
//! failure defaults to 400.
use std::{
    collections::HashMap,
    fmt,
    hash::Hash,
    str::FromStr,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

use crate::{
    annotation_access::{self, AnnotationMetadata, Restrictions},
    auth::AuthUser,
    dataset_access,
    error::ApiError,
    id::ObjectId,
    proto::{AnnotationLayerTypeProto, AnnotationProto},
    service_clients::ServiceError,
    tracingstore_client::{
        self, BoundingBox, MergeRequest, NamedBoundingBox, TRACING_STORE_NOT_FOUND,
        TracingStoreClient, TracingStoreError,
    },
};

/// Msg.Annotation.notFound, attached by provideAnnotation via `?~>`.
pub const ANNOTATION_NOT_FOUND: &str = "Annotation could not be found or accessed.";
/// Msg.Annotation.Restrictions.notFound, used by routes for restriction failures.
pub const RESTRICTIONS_NOT_FOUND: &str = "Could not determine annotation access restrictions.";
/// Msg.notFound: how Play renders an unwrapped `Fox.empty` (404).
pub const RESOURCE_NOT_FOUND: &str = "Could not find or access the requested resource.";
/// Msg.Annotation.Merge.failedCompound.
pub const MERGE_FAILED_COMPOUND: &str = "Could not merge annotations for compound view.";
/// AnnotationMerger.mergeN failure.
pub const MERGE_FAILED_IN_TRACINGSTORE: &str = "Failed to merge annotations in tracingstore.";
/// AnnotationInformationHandler.assertAllOnSameDataset.
pub const MULTIPLE_DATASETS: &str = "Cannot create compound annotation spanning multiple datasets";
/// AnnotationInformationHandler.assertNonEmpty (always chained below a handler message).
pub const NO_ANNOTATIONS: &str = "no annotations";
/// Msg.Task.noAnnotations.
pub const TASK_NO_ANNOTATIONS: &str = "Could not find finished annotations for this task.";
/// Msg.Project.noAnnotations.
pub const PROJECT_NO_ANNOTATIONS: &str = "Could not find annotations for this project.";
/// Msg.TaskType.noFinishedAnnotations.
pub const TASK_TYPE_NO_FINISHED_ANNOTATIONS: &str =
    "Could not find any finished annotations for this task type.";
/// Msg.User.notAuthenticated.
pub const USER_NOT_AUTHENTICATED: &str =
    "You are not authorized to view this resource. Please log in.";
/// Msg.Team.adminNotAllowed (UserService.isTeamManagerOrAdminOf failure).
pub const TEAM_ADMIN_NOT_ALLOWED: &str = "You do not have permission to administrate this team.";
/// Msg.Dataset.DataSource.notFound (`~> NOT_FOUND`).
pub const DATA_SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";
/// Msg.Dataset.DataSource.usableButNoVoxelSize.
pub const USABLE_BUT_NO_VOXEL_SIZE: &str = "Dataset is marked as usable but has no voxel size.";

/// AnnotationStore.cacheTimeout.
pub const COMPOUND_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
/// AnnotationDataSourceTemporaryStore.timeOut.
pub const DATA_SOURCE_STORE_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// TaskDAO.findAllByProjectAndTaskTypeAndIdsAndUser page size (first page only).
const TASK_TYPE_TASK_LIMIT: i64 = 1000;

/// Msg.Task.notFound(id).
pub fn task_not_found(id: &str) -> String {
    format!("Task “{id}” could not be found or accessed.")
}
/// Msg.Project.notFound(id).
pub fn project_not_found(id: &str) -> String {
    format!("Project “{id}” could not be found or accessed.")
}
/// Msg.TaskType.notFound(id).
pub fn task_type_not_found(id: &str) -> String {
    format!("Task type “{id}” could not be found or accessed.")
}
/// Msg.Dataset.notFoundForAnnotation(datasetId, annotationId).
pub fn dataset_not_found_for_annotation(dataset_id: &str, annotation_id: &str) -> String {
    format!(
        "Dataset “{dataset_id}” for annotation “{annotation_id}” does not exist or could not be accessed."
    )
}
/// Msg.Dataset.notUsable(id).
pub fn dataset_not_usable(id: &str) -> String {
    format!("Dataset “{id}” is not imported or incomplete.")
}

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

/// A Fox `Failure`/`ParamFailure`: exact message, the `?~>` chain below it
/// (outermost first) and the HTTP status of a ParamFailure, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoxFailure {
    pub message: String,
    pub chain: Vec<String>,
    pub status: Option<StatusCode>,
}

#[derive(Debug)]
pub enum ProviderError {
    /// `Invalid AnnotationType: <typ>` (Fox failure, default 400).
    InvalidType(String),
    /// Saved annotation missing, deleted or not DAO-readable: Msg.Annotation.notFound.
    NotFound,
    /// `Fox.empty` without a message (e.g. a missing project in compound
    /// restrictions). Routes attach their own message; unwrapped it renders
    /// as 404 Msg.notFound.
    Empty,
    /// Fox failure with its exact Scala message and chain.
    Failure(FoxFailure),
    /// Database or other infrastructure failure, passed through unchanged.
    Api(ApiError),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidType(typ) => write!(f, "Invalid AnnotationType: {typ}"),
            Self::NotFound => f.write_str(ANNOTATION_NOT_FOUND),
            Self::Empty => f.write_str(RESOURCE_NOT_FOUND),
            Self::Failure(failure) => f.write_str(&failure.message),
            Self::Api(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for ProviderError {}

impl From<ApiError> for ProviderError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}
impl From<sqlx::Error> for ProviderError {
    fn from(error: sqlx::Error) -> Self {
        Self::Api(error.into())
    }
}

impl ProviderError {
    fn failure(message: impl Into<String>) -> Self {
        Self::Failure(FoxFailure {
            message: message.into(),
            chain: Vec::new(),
            status: None,
        })
    }

    /// Fox `?~> message`: Empty becomes a plain failure, failures are chained
    /// below the new message keeping a ParamFailure status. Infrastructure
    /// errors are passed through unchanged.
    pub fn wrap(self, message: &str) -> Self {
        let (chain, status) = match self {
            Self::Api(error) => return Self::Api(error),
            Self::Empty => (Vec::new(), None),
            Self::Failure(FoxFailure {
                message: inner,
                mut chain,
                status,
            }) => {
                chain.insert(0, inner);
                (chain, status)
            }
            other @ (Self::InvalidType(_) | Self::NotFound) => (vec![other.to_string()], None),
        };
        Self::Failure(FoxFailure {
            message: message.to_owned(),
            chain,
            status,
        })
    }

    /// The Fox chain below the top-level message (outermost first).
    pub fn chain(&self) -> &[String] {
        match self {
            Self::Failure(failure) => &failure.chain,
            _ => &[],
        }
    }

    /// Fox semantics with an explicit route status (`~> status`): the status
    /// replaces any ParamFailure status and also applies to failures that
    /// would otherwise default to 400. Infrastructure errors keep their own
    /// status. Use `ApiError::from` for routes without `~>`.
    pub fn into_api_error(self, failure_status: StatusCode) -> ApiError {
        match self {
            Self::Api(error) => error,
            other => ApiError::new(failure_status, other.to_string()),
        }
    }
}

impl From<ProviderError> for ApiError {
    /// Play's default rendering: Failure → 400, ParamFailure → its status,
    /// Empty → 404 Msg.notFound.
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::Api(error) => error,
            ProviderError::Empty => ApiError::new(StatusCode::NOT_FOUND, RESOURCE_NOT_FOUND),
            ProviderError::Failure(FoxFailure {
                message, status, ..
            }) => ApiError::new(status.unwrap_or(StatusCode::BAD_REQUEST), message),
            other => ApiError::new(StatusCode::BAD_REQUEST, other.to_string()),
        }
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

/// AnnotationLayer.fromProto (statistics are `unknown` for merged layers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationLayer {
    pub tracing_id: String,
    pub typ: AnnotationLayerType,
    pub name: String,
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
        let layers = merged
            .annotation_layers
            .iter()
            .map(|layer| AnnotationLayer {
                tracing_id: layer.tracing_id.clone(),
                typ: match layer.typ() {
                    AnnotationLayerTypeProto::Skeleton => AnnotationLayerType::Skeleton,
                    AnnotationLayerTypeProto::Volume => AnnotationLayerType::Volume,
                },
                name: layer.name.clone(),
            })
            .collect();
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
    pub fn id(&self) -> &str {
        match self {
            Self::Saved(saved) => &saved.id,
            Self::Compound(compound) => compound.id.as_str(),
        }
    }
    pub fn owner_id(&self) -> &str {
        match self {
            Self::Saved(saved) => &saved.owner_id,
            Self::Compound(compound) => compound.owner_id.as_str(),
        }
    }
    pub fn dataset_id(&self) -> &str {
        match self {
            Self::Saved(saved) => &saved.dataset_id,
            Self::Compound(compound) => compound.dataset_id.as_str(),
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

/// In-process `TemporaryStore` with per-entry expiry. Expired entries are
/// invisible immediately and pruned on insert.
#[derive(Debug)]
struct TemporaryStore<K, V> {
    ttl: Duration,
    entries: Mutex<HashMap<K, (V, Instant)>>,
}

impl<K: Eq + Hash, V: Clone> TemporaryStore<K, V> {
    fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<K, (V, Instant)>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn insert(&self, key: K, value: V) {
        let now = Instant::now();
        let expiry = now.checked_add(self.ttl).unwrap_or(now);
        let mut entries = self.lock();
        entries.retain(|_, (_, expiry)| *expiry > now);
        entries.insert(key, (value, expiry));
    }

    fn get(&self, key: &K) -> Option<V> {
        let now = Instant::now();
        self.lock()
            .get(key)
            .filter(|(_, expiry)| *expiry > now)
            .map(|(value, _)| value.clone())
    }

    fn find(&self, predicate: impl Fn(&V) -> bool) -> Option<V> {
        let now = Instant::now();
        self.lock()
            .values()
            .find(|(value, expiry)| *expiry > now && predicate(value))
            .map(|(value, _)| value.clone())
    }

    fn remove(&self, key: &K) {
        self.lock().remove(key);
    }
}

/// Entry of the annotation data-source store: the usable DataSource JSON (as
/// sent to the datastore, real paths, credential ids included) and its dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporaryDataSource {
    pub data_source: Value,
    pub dataset_id: ObjectId,
}

/// `AnnotationDataSourceTemporaryStore`: process-wide, keyed by the
/// temporary (compound) annotation ID, i.e. the task/project/task-type ID,
/// kept for seven days. The tracing-store callbacks (`dataSource`,
/// `datasetId`) consult it before the annotation DAO. Cheap to clone; clones
/// share the store.
#[derive(Debug, Clone)]
pub struct AnnotationDataSourceStore {
    store: Arc<TemporaryStore<ObjectId, TemporaryDataSource>>,
}

impl Default for AnnotationDataSourceStore {
    fn default() -> Self {
        Self::with_ttl(DATA_SOURCE_STORE_TTL)
    }
}

impl AnnotationDataSourceStore {
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            store: Arc::new(TemporaryStore::new(ttl)),
        }
    }

    pub fn store(&self, annotation_id: ObjectId, data_source: Value, dataset_id: ObjectId) {
        self.store.insert(
            annotation_id,
            TemporaryDataSource {
                data_source,
                dataset_id,
            },
        );
    }

    pub fn find(&self, annotation_id: &ObjectId) -> Option<TemporaryDataSource> {
        self.store.get(annotation_id)
    }
}

/// Live Task annotation as needed by the compound handlers.
#[derive(Debug, Clone, FromRow)]
struct TaskAnnotation {
    id: String,
    dataset_id: String,
    owner_id: String,
    state: String,
}

const TASK_ANNOTATION_COLUMNS: &str =
    "a._id AS id,a._dataset AS dataset_id,a._user AS owner_id,a.state::text AS state";

/// TaskDAO.readAccessQ, alias `t`: requester ($1) has a role in the project's
/// team, or is an administrator ($3) of the team's organization ($2). The
/// project/team subselects include soft-deleted rows like Scala's; role
/// grants are scoped to the requester's organization.
const TASK_READ: &str = r#"EXISTS(SELECT 1 FROM webknossos.projects access_project
    JOIN webknossos.teams access_team ON access_team._id=access_project._team
    WHERE access_project._id=t._project AND access_team._organization=$2 AND ($3 OR EXISTS(
      SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=$1 AND role._team=access_project._team)))"#;

/// TaskDAO.listAccessQ (= deleteAccessQ): team manager of the project's team
/// or administrator of the team's organization.
const TASK_LIST: &str = r#"EXISTS(SELECT 1 FROM webknossos.projects access_project
    JOIN webknossos.teams access_team ON access_team._id=access_project._team
    WHERE access_project._id=t._project AND access_team._organization=$2 AND ($3 OR EXISTS(
      SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=$1 AND role._team=access_project._team AND role.isTeamManager)))"#;

/// ProjectDAO.readAccessQ, alias `p`.
const PROJECT_READ: &str = r#"(p._organization=$2 AND (p._owner=$1 OR $3 OR EXISTS(
    SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=$1 AND role._team=p._team)))"#;

/// TaskTypeDAO.readAccessQ, alias `tt`.
const TASK_TYPE_READ: &str = r#"(tt._organization=$2 AND ($3 OR EXISTS(
    SELECT 1 FROM webknossos.user_team_roles role WHERE role._user=$1 AND role._team=tt._team)))"#;

/// AnnotationInformationProvider + AnnotationStore. Cheap to clone; clones
/// share the compound cache and the data-source store. Exposed to handlers
/// as an Axum `Extension`.
#[derive(Clone, Debug)]
pub struct AnnotationProvider {
    pool: PgPool,
    tracing_store: TracingStoreClient,
    data_sources: AnnotationDataSourceStore,
    compound_cache: Arc<TemporaryStore<String, CompoundAnnotation>>,
}

impl AnnotationProvider {
    pub fn new(pool: PgPool, tracing_store: TracingStoreClient) -> Self {
        Self::with_compound_cache_ttl(pool, tracing_store, COMPOUND_CACHE_TTL)
    }

    /// As `new`, with an injectable compound cache expiry (tests).
    pub fn with_compound_cache_ttl(
        pool: PgPool,
        tracing_store: TracingStoreClient,
        compound_cache_ttl: Duration,
    ) -> Self {
        Self {
            pool,
            tracing_store,
            data_sources: AnnotationDataSourceStore::default(),
            compound_cache: Arc::new(TemporaryStore::new(compound_cache_ttl)),
        }
    }

    /// The shared AnnotationDataSourceTemporaryStore.
    pub fn data_sources(&self) -> &AnnotationDataSourceStore {
        &self.data_sources
    }

    /// AnnotationStore.findInCache: a live cached compound by its (parent) ID.
    pub fn find_in_cache(&self, annotation_id: &ObjectId) -> Option<CompoundAnnotation> {
        self.compound_cache
            .find(|annotation| &annotation.id == annotation_id)
    }

    /// AnnotationStore.findCachedByTracingId.
    pub fn find_cached_by_tracing_id(&self, tracing_id: &str) -> Option<CompoundAnnotation> {
        self.compound_cache.find(|annotation| {
            annotation
                .layers
                .iter()
                .any(|layer| layer.tracing_id == tracing_id)
        })
    }

    /// AnnotationStore.removeFromCache.
    pub fn remove_from_cache(&self, identifier: &AnnotationIdentifier) {
        self.compound_cache.remove(&identifier.to_unique_string());
    }

    /// provideAnnotation(typ, id, userOpt): parse the type, then dispatch.
    /// Compound failures are wrapped as Msg.Annotation.notFound (`?~>`).
    pub async fn provide(
        &self,
        context: AccessContext<'_>,
        typ: &str,
        id: &ObjectId,
    ) -> Result<ProvidedAnnotation, ProviderError> {
        let identifier = AnnotationIdentifier::parse(typ, id)?;
        self.provide_identifier(context, &identifier)
            .await
            .map_err(|error| match error {
                ProviderError::Empty | ProviderError::Failure(_) => {
                    error.wrap(ANNOTATION_NOT_FOUND)
                }
                other => other,
            })
    }

    /// AnnotationStore.requestAnnotation. Saved annotations are never cached;
    /// compounds come from the cache or the handler (then cached).
    pub async fn provide_identifier(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<ProvidedAnnotation, ProviderError> {
        if identifier.annotation_type.is_compound() {
            self.provide_compound(context, identifier)
                .await
                .map(ProvidedAnnotation::Compound)
        } else {
            self.provide_saved(context, &identifier.identifier)
                .await
                .map(|saved| ProvidedAnnotation::Saved(Box::new(saved)))
        }
    }

    /// SavedTracingInformationHandler.provideAnnotation: the live annotation
    /// by ID under AnnotationDAO read access. The requested saved type is not
    /// compared with the stored type (a `View` path may resolve a Task row).
    pub async fn provide_saved(
        &self,
        context: AccessContext<'_>,
        annotation_id: &ObjectId,
    ) -> Result<AnnotationMetadata, ProviderError> {
        annotation_access::find_optional(
            &self.pool,
            context.requester,
            annotation_id.as_str(),
            context.global,
        )
        .await?
        .ok_or(ProviderError::NotFound)
    }

    /// AnnotationInformationProvider.restrictionsFor(typ, id). Not cached;
    /// the saved handler re-reads under DAO access and applies the defaults
    /// for the requester.
    pub async fn restrictions_for(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<Restrictions, ProviderError> {
        if identifier.annotation_type.is_compound() {
            return self.compound_restrictions(context, identifier).await;
        }
        let annotation = self.provide_saved(context, &identifier.identifier).await?;
        Ok(annotation_access::restrictions(
            &annotation,
            context.requester,
        ))
    }

    /// AnnotationStore cache lookup, else the compound handler. Only
    /// successful merges are cached; a hit never re-runs the handler.
    async fn provide_compound(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<CompoundAnnotation, ProviderError> {
        let key = identifier.to_unique_string();
        if let Some(cached) = self.compound_cache.get(&key) {
            return Ok(cached);
        }
        let annotation = match identifier.annotation_type {
            AnnotationType::CompoundTask => self.compound_task(context, identifier).await?,
            AnnotationType::CompoundProject => self.compound_project(context, identifier).await?,
            AnnotationType::CompoundTaskType => {
                self.compound_task_type(context, identifier).await?
            }
            saved => return Err(ProviderError::InvalidType(saved.to_string())),
        };
        self.compound_cache.insert(key, annotation.clone());
        Ok(annotation)
    }

    /// TaskInformationHandler.provideAnnotation.
    async fn compound_task(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<CompoundAnnotation, ProviderError> {
        let task_id = identifier.identifier.as_str();
        let project_id = self
            .find_task_project(context, task_id)
            .await?
            .ok_or_else(|| ProviderError::failure(task_not_found(task_id)))?;
        let annotations = self
            .task_annotations(context, &[task_id.to_owned()])
            .await?;
        let finished = finished(&annotations);
        assert_all_on_same_dataset(&finished)?;
        assert_non_empty(&finished).map_err(|e| e.wrap(TASK_NO_ANNOTATIONS))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(USER_NOT_AUTHENTICATED))?;
        self.find_project_team(context, &project_id)
            .await?
            .ok_or_else(|| ProviderError::failure(project_not_found(&project_id)))?;
        let dataset_id = finished[0].dataset_id.clone();
        self.register_data_source(&identifier.identifier, &dataset_id)
            .await?;
        // Boxes for every accessible instance, not only the finished ones.
        let boxes = self.task_bounding_boxes(&ids(&annotations)).await?;
        self.merge(context, identifier, user, &dataset_id, &finished, boxes)
            .await
            .map_err(|e| e.wrap(MERGE_FAILED_COMPOUND))
    }

    /// ProjectInformationHandler.provideAnnotation.
    async fn compound_project(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<CompoundAnnotation, ProviderError> {
        let project_id = identifier.identifier.as_str();
        let team = self
            .find_project_team(context, project_id)
            .await?
            .ok_or_else(|| ProviderError::failure(project_not_found(project_id)))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(USER_NOT_AUTHENTICATED))?;
        // Fox.assertTrue: false is Empty, a lookup failure stays a failure.
        if !self.is_team_manager_or_admin_of(user, &team).await? {
            return Err(ProviderError::Empty);
        }
        // AnnotationDAO.findAllFinishedForProject has no annotation read
        // predicate: authorization is the team-manager assertion above.
        let annotations: Vec<TaskAnnotation> = sqlx::query_as(&format!(
            "SELECT {TASK_ANNOTATION_COLUMNS} FROM webknossos.annotations_ a
             JOIN webknossos.tasks_ t ON a._task=t._id
             WHERE t._project=$1 AND a.typ='Task' AND a.state='Finished'
             ORDER BY a.created,a._id"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        assert_all_on_same_dataset(&annotations)?;
        assert_non_empty(&annotations).map_err(|e| e.wrap(PROJECT_NO_ANNOTATIONS))?;
        let dataset_id = annotations[0].dataset_id.clone();
        self.register_data_source(&identifier.identifier, &dataset_id)
            .await?;
        let boxes = self.task_bounding_boxes(&ids(&annotations)).await?;
        let annotations: Vec<&TaskAnnotation> = annotations.iter().collect();
        self.merge(context, identifier, user, &dataset_id, &annotations, boxes)
            .await
            .map_err(|e| e.wrap(MERGE_FAILED_COMPOUND))
    }

    /// TaskTypeInformationHandler.provideAnnotation. No team-manager
    /// assertion here (only in its restrictions); tasks are listed with the
    /// TaskDAO list grant (first page of 1000) and annotations under the
    /// annotation read predicate.
    async fn compound_task_type(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<CompoundAnnotation, ProviderError> {
        let task_type_id = identifier.identifier.as_str();
        self.find_task_type_team(context, task_type_id)
            .await?
            .ok_or_else(|| ProviderError::failure(task_type_not_found(task_type_id)))?;
        let (user_id, organization, is_admin) = requester_binds(context);
        let tasks: Vec<String> = sqlx::query_scalar(&format!(
            "SELECT t._id FROM webknossos.tasks_ t WHERE t._taskType=$4 AND ($5 OR {TASK_LIST})
             ORDER BY t._id LIMIT $6"
        ))
        .bind(user_id)
        .bind(organization)
        .bind(is_admin)
        .bind(task_type_id)
        .bind(context.global)
        .bind(TASK_TYPE_TASK_LIMIT)
        .fetch_all(&self.pool)
        .await?;
        let annotations = self.task_annotations(context, &tasks).await?;
        let finished = finished(&annotations);
        assert_all_on_same_dataset(&finished)?;
        assert_non_empty(&finished).map_err(|e| e.wrap(TASK_TYPE_NO_FINISHED_ANNOTATIONS))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(USER_NOT_AUTHENTICATED))?;
        let dataset_id = finished[0].dataset_id.clone();
        self.register_data_source(&identifier.identifier, &dataset_id)
            .await?;
        let boxes = self.task_bounding_boxes(&ids(&annotations)).await?;
        self.merge(context, identifier, user, &dataset_id, &finished, boxes)
            .await
            .map_err(|e| e.wrap(MERGE_FAILED_COMPOUND))
    }

    /// Compound restriction handlers: the parent is re-read under DAO
    /// access; allowAccess (and so allowDownload) is "team manager of the
    /// parent's team or administrator of its organization"; update and
    /// finish are never allowed. Not cached.
    async fn compound_restrictions(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<Restrictions, ProviderError> {
        let id = identifier.identifier.as_str();
        let team = match identifier.annotation_type {
            AnnotationType::CompoundTask => {
                let project = self
                    .find_task_project(context, id)
                    .await?
                    .ok_or_else(|| ProviderError::failure(task_not_found(id)))?;
                self.find_project_team(context, &project)
                    .await?
                    .ok_or_else(|| ProviderError::failure(project_not_found(&project)))?
            }
            // projectDAO.findOne without a message: plain Fox.empty.
            AnnotationType::CompoundProject => self
                .find_project_team(context, id)
                .await?
                .ok_or(ProviderError::Empty)?,
            AnnotationType::CompoundTaskType => self
                .find_task_type_team(context, id)
                .await?
                .ok_or_else(|| ProviderError::failure(task_type_not_found(id)))?,
            saved => return Err(ProviderError::InvalidType(saved.to_string())),
        };
        // `.orElse(Fox.successful(false))`: missing user or team → false.
        // Infrastructure errors are not swallowed.
        let allow_access = match context.requester {
            Some(user) => match self.is_team_manager_or_admin_of(user, &team).await {
                Ok(allowed) => allowed,
                Err(ProviderError::Api(error)) => return Err(error.into()),
                Err(_) => false,
            },
            None => false,
        };
        Ok(Restrictions {
            allow_access,
            allow_update: false,
            allow_update_with_mutex: false,
            allow_finish: false,
            allow_finish_soft: false,
            allow_download: allow_access,
        })
    }

    /// TaskDAO.findOne under the access context: the task's project ID.
    async fn find_task_project(
        &self,
        context: AccessContext<'_>,
        task_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let (user_id, organization, is_admin) = requester_binds(context);
        Ok(sqlx::query_scalar(&format!(
            "SELECT t._project FROM webknossos.tasks_ t WHERE t._id=$4 AND ($5 OR {TASK_READ})"
        ))
        .bind(user_id)
        .bind(organization)
        .bind(is_admin)
        .bind(task_id)
        .bind(context.global)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// ProjectDAO.findOne under the access context: the project's team.
    async fn find_project_team(
        &self,
        context: AccessContext<'_>,
        project_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let (user_id, organization, is_admin) = requester_binds(context);
        Ok(sqlx::query_scalar(&format!(
            "SELECT p._team FROM webknossos.projects_ p WHERE p._id=$4 AND ($5 OR {PROJECT_READ})"
        ))
        .bind(user_id)
        .bind(organization)
        .bind(is_admin)
        .bind(project_id)
        .bind(context.global)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// TaskTypeDAO.findOne under the access context: the task type's team.
    async fn find_task_type_team(
        &self,
        context: AccessContext<'_>,
        task_type_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let (user_id, organization, is_admin) = requester_binds(context);
        Ok(sqlx::query_scalar(&format!(
            "SELECT tt._team FROM webknossos.taskTypes_ tt WHERE tt._id=$4 AND ($5 OR {TASK_TYPE_READ})"
        ))
        .bind(user_id)
        .bind(organization)
        .bind(is_admin)
        .bind(task_type_id)
        .bind(context.global)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// AnnotationDAO.findAllByTaskIdAndType(task, Task) for each task in
    /// order (Fox.serialCombined): live, non-cancelled, readable.
    async fn task_annotations(
        &self,
        context: AccessContext<'_>,
        task_ids: &[String],
    ) -> Result<Vec<TaskAnnotation>, ProviderError> {
        let (user_id, organization, is_admin) = requester_binds(context);
        Ok(sqlx::query_as(&format!(
            "SELECT {TASK_ANNOTATION_COLUMNS} FROM webknossos.annotations_ a
             JOIN unnest($4::text[]) WITH ORDINALITY AS requested(task, position) ON requested.task=a._task
             WHERE a.typ='Task' AND a.state<>'Cancelled' AND ($5 OR {})
             ORDER BY requested.position,a.created,a._id",
            annotation_access::READ_PREDICATE
        ))
        .bind(user_id)
        .bind(organization)
        .bind(is_admin)
        .bind(task_ids)
        .bind(context.global)
        .fetch_all(&self.pool)
        .await?)
    }

    /// UserService.isTeamManagerOrAdminOf(user, team): the live team is read
    /// globally (missing → Msg.Team.adminNotAllowed failure); the user must
    /// manage the team or administer its organization. Team-manager roles
    /// only count for teams of the user's organization.
    async fn is_team_manager_or_admin_of(
        &self,
        user: &AuthUser,
        team_id: &str,
    ) -> Result<bool, ProviderError> {
        let team: Option<(String, bool)> = sqlx::query_as(
            "SELECT team._organization,EXISTS(SELECT 1 FROM webknossos.user_team_roles role
               WHERE role._team=team._id AND role._user=$2 AND role.isTeamManager)
             FROM webknossos.teams_ team WHERE team._id=$1",
        )
        .bind(team_id)
        .bind(&user.id)
        .fetch_optional(&self.pool)
        .await?;
        let (organization, manages) =
            team.ok_or_else(|| ProviderError::failure(TEAM_ADMIN_NOT_ALLOWED))?;
        Ok(organization == user.organization_id && (manages || user.is_admin))
    }

    /// AnnotationInformationHandler.registerDataSourceInTemporaryStore: the
    /// live dataset (global access) as usable data source, stored under the
    /// temporary annotation (= parent) ID.
    async fn register_data_source(
        &self,
        temporary_annotation_id: &ObjectId,
        dataset_id: &str,
    ) -> Result<(), ProviderError> {
        let dataset: Option<(bool, bool)> = sqlx::query_as(
            "SELECT isUsable,voxelSizeFactor IS NOT NULL FROM webknossos.datasets_ WHERE _id=$1",
        )
        .bind(dataset_id)
        .fetch_optional(&self.pool)
        .await?;
        let (usable, has_voxel_size) = dataset.ok_or_else(|| {
            ProviderError::failure(dataset_not_found_for_annotation(
                dataset_id,
                temporary_annotation_id.as_str(),
            ))
        })?;
        if !usable {
            return Err(ProviderError::failure(dataset_not_usable(dataset_id)));
        }
        if !has_voxel_size {
            return Err(ProviderError::Failure(FoxFailure {
                message: DATA_SOURCE_NOT_FOUND.to_owned(),
                chain: vec![USABLE_BUT_NO_VOXEL_SIZE.to_owned()],
                status: Some(StatusCode::NOT_FOUND),
            }));
        }
        let data_source =
            crate::datasets::data_source_for_rpc(&self.pool, dataset_id, true).await?;
        self.data_sources.store(
            temporary_annotation_id.clone(),
            data_source,
            ObjectId::parse(dataset_id)?,
        );
        Ok(())
    }

    /// TaskDAO.findTaskBoundingBoxesByAnnotationIds (no access predicate).
    async fn task_bounding_boxes(
        &self,
        annotation_ids: &[String],
    ) -> Result<Vec<NamedBoundingBox>, ProviderError> {
        type Row = (
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            Option<f64>,
            String,
            String,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT (t.boundingBox).x,(t.boundingBox).y,(t.boundingBox).z,
               (t.boundingBox).width,(t.boundingBox).height,(t.boundingBox).depth,t._id,a._id
             FROM webknossos.tasks_ t JOIN webknossos.annotations_ a ON a._task=t._id
             WHERE a._id=ANY($1) AND t.boundingBox IS NOT NULL ORDER BY t._id,a._id",
        )
        .bind(annotation_ids)
        .fetch_all(&self.pool)
        .await?;
        let mut boxes = Vec::with_capacity(rows.len());
        for (x, y, z, width, height, depth, task_id, annotation_id) in rows {
            // BoundingBox.fromSQL needs all six components; parseArrayLiteral
            // `.toInt` throws on fractional values, failing the handler.
            let components = [x, y, z, width, height, depth];
            if components.iter().any(Option::is_none) {
                continue;
            }
            let Some([x, y, z, width, height, depth]) = components
                .iter()
                .map(|value| value.and_then(sql_int))
                .collect::<Option<Vec<i32>>>()
                .and_then(|values| <[i32; 6]>::try_from(values).ok())
            else {
                return Err(ProviderError::failure(format!(
                    "Invalid bounding box of task {task_id}"
                )));
            };
            boxes.push(NamedBoundingBox {
                id: 0,
                name: Some(format!(
                    "Task bounding box of instance {annotation_id} of task {task_id}"
                )),
                is_visible: None,
                color: None,
                bounding_box: BoundingBox {
                    top_left: [x, y, z],
                    width,
                    height,
                    depth,
                },
            });
        }
        Ok(boxes)
    }

    /// AnnotationMerger.mergeN(toTemporaryStore = true, remapSegmentIds =
    /// true) and its mergeAnnotationsInTracingstore (`?~> "Failed to merge
    /// annotations in tracingstore."`).
    async fn merge(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
        user: &AuthUser,
        dataset_id: &str,
        annotations: &[&TaskAnnotation],
        additional_bounding_boxes: Vec<NamedBoundingBox>,
    ) -> Result<CompoundAnnotation, ProviderError> {
        if annotations.is_empty() {
            return Err(ProviderError::Empty);
        }
        let requesting_user_id = ObjectId::parse(&user.id)?;
        let dataset_id = ObjectId::parse(dataset_id)?;
        let merged = self
            .merge_in_tracing_store(
                context,
                identifier,
                &requesting_user_id,
                &dataset_id,
                annotations,
                additional_bounding_boxes,
            )
            .await
            .map_err(|e| e.wrap(MERGE_FAILED_IN_TRACINGSTORE))?;
        Ok(CompoundAnnotation::from_merge(
            identifier,
            dataset_id,
            requesting_user_id,
            &merged,
        ))
    }

    async fn merge_in_tracing_store(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
        requesting_user_id: &ObjectId,
        dataset_id: &ObjectId,
        annotations: &[&TaskAnnotation],
        additional_bounding_boxes: Vec<NamedBoundingBox>,
    ) -> Result<AnnotationProto, ProviderError> {
        // datasetDAO.findOne(datasetId) under the caller's access context.
        let readable: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=$3 AND ($4 OR {}))",
            dataset_access::READ_PREDICATE
        ))
        .bind(context.requester.map(|user| user.id.as_str()))
        .bind(None::<String>)
        .bind(dataset_id.as_str())
        .bind(context.global)
        .fetch_one(&self.pool)
        .await?;
        if !readable {
            return Err(ProviderError::Empty);
        }
        let url = tracingstore_client::find_first_tracing_store_url(&self.pool)
            .await?
            .ok_or_else(|| ProviderError::failure(TRACING_STORE_NOT_FOUND))?;
        let mut annotation_ids = Vec::with_capacity(annotations.len());
        let mut owner_ids = Vec::with_capacity(annotations.len());
        for annotation in annotations {
            annotation_ids.push(ObjectId::parse(&annotation.id)?);
            owner_ids.push(ObjectId::parse(&annotation.owner_id)?);
        }
        let request = MergeRequest {
            annotation_ids,
            owner_ids,
            additional_bounding_boxes,
            new_annotation_id: identifier.identifier.clone(),
            to_temporary_store: true,
            requesting_user_id: requesting_user_id.clone(),
            remap_segment_ids: true,
        };
        self.tracing_store
            .merge_annotations_by_ids(&url, &request)
            .await
            .map_err(tracing_store_failure)
    }
}

/// RPC failures are Fox failures; only an unsuccessful upstream HTTP status
/// is kept as a ParamFailure status (RPCRequest `~> result.status`).
fn tracing_store_failure(error: TracingStoreError) -> ProviderError {
    let status = match &error {
        TracingStoreError::Service(ServiceError::UpstreamStatus(code)) => {
            StatusCode::from_u16(*code).ok()
        }
        _ => None,
    };
    ProviderError::Failure(FoxFailure {
        message: error.to_string(),
        chain: Vec::new(),
        status,
    })
}

/// Bind values $1 requester id, $2 requester organization, $3 requester is
/// an administrator (of $2).
fn requester_binds<'a>(context: AccessContext<'a>) -> (Option<&'a str>, Option<&'a str>, bool) {
    let user = context.requester;
    (
        user.map(|u| u.id.as_str()),
        user.map(|u| u.organization_id.as_str()),
        user.is_some_and(|u| u.is_admin),
    )
}

fn finished(annotations: &[TaskAnnotation]) -> Vec<&TaskAnnotation> {
    annotations
        .iter()
        .filter(|annotation| annotation.state == "Finished")
        .collect()
}

fn ids(annotations: &[TaskAnnotation]) -> Vec<String> {
    annotations
        .iter()
        .map(|annotation| annotation.id.clone())
        .collect()
}

fn assert_all_on_same_dataset<A: std::borrow::Borrow<TaskAnnotation>>(
    annotations: &[A],
) -> Result<(), ProviderError> {
    match annotations.first() {
        Some(first)
            if annotations
                .iter()
                .any(|a| a.borrow().dataset_id != first.borrow().dataset_id) =>
        {
            Err(ProviderError::failure(MULTIPLE_DATASETS))
        }
        _ => Ok(()),
    }
}

fn assert_non_empty<T>(items: &[T]) -> Result<(), ProviderError> {
    if items.is_empty() {
        Err(ProviderError::failure(NO_ANNOTATIONS))
    } else {
        Ok(())
    }
}

fn sql_int(value: f64) -> Option<i32> {
    if value.fract() == 0.0 && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX) {
        #[allow(clippy::cast_possible_truncation)]
        Some(value as i32)
    } else {
        None
    }
}
