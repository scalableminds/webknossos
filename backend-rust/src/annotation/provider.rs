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
mod annotation_provider_dao;
mod compound;
mod error;
mod merge;
mod temporary_store;
mod types;

use std::{sync::Arc, time::Duration};

use axum::http::StatusCode;
use sqlx::PgPool;

pub(crate) use annotation_provider_dao::{push_task_list, push_task_read, push_task_type_read};

use crate::{
    annotation::access::{AnnotationMetadata, Restrictions},
    stores::tracing_client::TracingStoreClient,
    util::id::ObjectId,
};

pub use error::{FoxFailure, ProviderError};
use temporary_store::TemporaryStore;
pub use temporary_store::{AnnotationDataSourceStore, TemporaryDataSource};
pub(crate) use types::layers_from_proto;
pub use types::{
    AccessContext, AnnotationIdentifier, AnnotationLayer, AnnotationLayerType, AnnotationType,
    CompoundAnnotation, ProvidedAnnotation,
};

/// Msg.Annotation.Restrictions.notFound, used by routes for restriction failures.
pub const RESTRICTIONS_NOT_FOUND: &str = "Could not determine annotation access restrictions.";
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

/// AnnotationStore.cacheTimeout.
pub const COMPOUND_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
/// AnnotationDataSourceTemporaryStore.timeOut.
pub const DATA_SOURCE_STORE_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

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
                    error.wrap(crate::msg::annotation::NOT_FOUND)
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
            // Compounds are cached independently of the requester, so access is
            // checked on every request, before the potentially expensive merge:
            // Fox.assertTrue(restrictionsFor(..).allowAccess) ?~> notAllowed ~> 403.
            let not_allowed = |error: ProviderError| {
                error
                    .wrap(crate::msg::NOT_ALLOWED)
                    .with_status(StatusCode::FORBIDDEN)
            };
            match self.compound_restrictions(context, identifier).await {
                Ok(restrictions) if restrictions.allow_access => {}
                Ok(_) => return Err(not_allowed(ProviderError::Empty)),
                Err(error) => return Err(not_allowed(error)),
            }
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
        crate::annotation::access::find_optional(
            &self.pool,
            context.requester,
            annotation_id,
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
        Ok(crate::annotation::access::restrictions(
            &annotation,
            context.requester,
        ))
    }
}
