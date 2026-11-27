//! `AnnotationMerger.mergeN`: merging the finished annotations of a compound annotation.

use crate::{
    auth::AuthUser,
    proto::AnnotationProto,
    stores::tracing_client::{MergeRequest, NamedBoundingBox},
    util::id::ObjectId,
};

use super::{
    compound::TaskAnnotation,
    error::ProviderError,
    types::{AccessContext, AnnotationIdentifier, CompoundAnnotation},
    {AnnotationProvider, MERGE_FAILED_IN_TRACINGSTORE, annotation_provider_dao},
};

impl AnnotationProvider {
    /// AnnotationMerger.mergeN(toTemporaryStore = true, remapSegmentIds =
    /// true) and its mergeAnnotationsInTracingstore (`?~> "Failed to merge
    /// annotations in tracingstore."`).
    pub(super) async fn merge(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
        user: &AuthUser,
        dataset_id: &ObjectId,
        annotations: &[&TaskAnnotation],
        additional_bounding_boxes: Vec<NamedBoundingBox>,
    ) -> Result<CompoundAnnotation, ProviderError> {
        if annotations.is_empty() {
            return Err(ProviderError::Empty);
        }
        let requesting_user_id = user.id.clone();
        let merged = self
            .merge_in_tracing_store(
                context,
                identifier,
                &requesting_user_id,
                dataset_id,
                annotations,
                additional_bounding_boxes,
            )
            .await
            .map_err(|e| e.wrap(MERGE_FAILED_IN_TRACINGSTORE))?;
        Ok(CompoundAnnotation::from_merge(
            identifier,
            dataset_id.clone(),
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
        let readable =
            annotation_provider_dao::is_dataset_readable(&self.pool, context, dataset_id).await?;
        if !readable {
            return Err(ProviderError::Empty);
        }
        let url = crate::stores::tracing_client::find_first_tracing_store_url(&self.pool)
            .await?
            .ok_or_else(|| ProviderError::failure(crate::msg::tracing_store::NOT_FOUND))?;
        let mut annotation_ids = Vec::with_capacity(annotations.len());
        let mut owner_ids = Vec::with_capacity(annotations.len());
        for annotation in annotations {
            annotation_ids.push(annotation.id.clone());
            owner_ids.push(annotation.owner_id.clone());
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
            .map_err(ProviderError::from)
    }
}
