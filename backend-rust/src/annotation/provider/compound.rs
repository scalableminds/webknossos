//! The compound handlers (`TaskInformationHandler`, `ProjectInformationHandler`,
//! `TaskTypeInformationHandler`) and their restrictions.

use axum::http::StatusCode;
use sqlx::FromRow;

use crate::{
    annotation::access::Restrictions, auth::AuthUser, stores::tracing_client::NamedBoundingBox,
    util::id::ObjectId,
};
use webknossos_common::geometry::{BoundingBox, Vec3Int};

use super::{
    error::{FoxFailure, ProviderError},
    types::{AccessContext, AnnotationIdentifier, AnnotationType, CompoundAnnotation},
    {
        AnnotationProvider, MERGE_FAILED_COMPOUND, MULTIPLE_DATASETS, NO_ANNOTATIONS,
        PROJECT_NO_ANNOTATIONS, TASK_NO_ANNOTATIONS, TASK_TYPE_NO_FINISHED_ANNOTATIONS,
        annotation_provider_dao,
    },
};

/// Live Task annotation as needed by the compound handlers.
#[derive(Debug, Clone, FromRow)]
pub(super) struct TaskAnnotation {
    pub(super) id: ObjectId,
    dataset_id: ObjectId,
    pub(super) owner_id: ObjectId,
    state: String,
}

pub(super) const TASK_ANNOTATION_COLUMNS: &str =
    "a._id AS id,a._dataset AS dataset_id,a._user AS owner_id,a.state::text AS state";

fn finished(annotations: &[TaskAnnotation]) -> Vec<&TaskAnnotation> {
    annotations
        .iter()
        .filter(|annotation| annotation.state == "Finished")
        .collect()
}

fn ids(annotations: &[TaskAnnotation]) -> Vec<ObjectId> {
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

impl AnnotationProvider {
    /// AnnotationStore cache lookup, else the compound handler. Only
    /// successful merges are cached; a hit never re-runs the handler.
    pub(super) async fn provide_compound(
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
        let task_id = &identifier.identifier;
        let project_id = self
            .find_task_project(context, task_id)
            .await?
            .ok_or_else(|| ProviderError::failure(crate::msg::task::not_found(task_id)))?;
        let annotations = self
            .task_annotations(context, std::slice::from_ref(task_id))
            .await?;
        let finished = finished(&annotations);
        assert_all_on_same_dataset(&finished)?;
        assert_non_empty(&finished).map_err(|e| e.wrap(TASK_NO_ANNOTATIONS))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(crate::msg::user::NOT_AUTHENTICATED))?;
        self.find_project_team(context, &project_id)
            .await?
            .ok_or_else(|| ProviderError::failure(crate::msg::project::not_found(&project_id)))?;
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
        let project_id = &identifier.identifier;
        let team = self
            .find_project_team(context, project_id)
            .await?
            .ok_or_else(|| ProviderError::failure(crate::msg::project::not_found(project_id)))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(crate::msg::user::NOT_AUTHENTICATED))?;
        // Fox.assertTrue: false is Empty, a lookup failure stays a failure.
        if !self.is_team_manager_or_admin_of(user, &team).await? {
            return Err(ProviderError::Empty);
        }
        let annotations =
            annotation_provider_dao::find_all_finished_for_project(&self.pool, project_id).await?;
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
        let task_type_id = &identifier.identifier;
        self.find_task_type_team(context, task_type_id)
            .await?
            .ok_or_else(|| {
                ProviderError::failure(crate::msg::task_type::not_found(task_type_id))
            })?;
        let tasks = annotation_provider_dao::find_all_task_ids_for_task_type(
            &self.pool,
            context,
            task_type_id,
        )
        .await?;
        let annotations = self.task_annotations(context, &tasks).await?;
        let finished = finished(&annotations);
        assert_all_on_same_dataset(&finished)?;
        assert_non_empty(&finished).map_err(|e| e.wrap(TASK_TYPE_NO_FINISHED_ANNOTATIONS))?;
        let user = context
            .requester
            .ok_or_else(|| ProviderError::failure(crate::msg::user::NOT_AUTHENTICATED))?;
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
    pub(super) async fn compound_restrictions(
        &self,
        context: AccessContext<'_>,
        identifier: &AnnotationIdentifier,
    ) -> Result<Restrictions, ProviderError> {
        let id = &identifier.identifier;
        let team = match identifier.annotation_type {
            AnnotationType::CompoundTask => {
                let project = self
                    .find_task_project(context, id)
                    .await?
                    .ok_or_else(|| ProviderError::failure(crate::msg::task::not_found(id)))?;
                self.find_project_team(context, &project)
                    .await?
                    .ok_or_else(|| {
                        ProviderError::failure(crate::msg::project::not_found(&project))
                    })?
            }
            // projectDAO.findOne without a message: plain Fox.empty.
            AnnotationType::CompoundProject => self
                .find_project_team(context, id)
                .await?
                .ok_or(ProviderError::Empty)?,
            AnnotationType::CompoundTaskType => self
                .find_task_type_team(context, id)
                .await?
                .ok_or_else(|| ProviderError::failure(crate::msg::task_type::not_found(id)))?,
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
        task_id: &ObjectId,
    ) -> Result<Option<ObjectId>, ProviderError> {
        Ok(annotation_provider_dao::find_task_project(&self.pool, context, task_id).await?)
    }

    /// ProjectDAO.findOne under the access context: the project's team.
    async fn find_project_team(
        &self,
        context: AccessContext<'_>,
        project_id: &ObjectId,
    ) -> Result<Option<ObjectId>, ProviderError> {
        Ok(annotation_provider_dao::find_project_team(&self.pool, context, project_id).await?)
    }

    /// TaskTypeDAO.findOne under the access context: the task type's team.
    async fn find_task_type_team(
        &self,
        context: AccessContext<'_>,
        task_type_id: &ObjectId,
    ) -> Result<Option<ObjectId>, ProviderError> {
        Ok(annotation_provider_dao::find_task_type_team(&self.pool, context, task_type_id).await?)
    }

    /// AnnotationDAO.findAllByTaskIdAndType(task, Task) for each task in
    /// order (Fox.serialCombined): live, non-cancelled, readable.
    async fn task_annotations(
        &self,
        context: AccessContext<'_>,
        task_ids: &[ObjectId],
    ) -> Result<Vec<TaskAnnotation>, ProviderError> {
        Ok(
            annotation_provider_dao::find_all_task_annotations(&self.pool, context, task_ids)
                .await?,
        )
    }

    /// UserService.isTeamManagerOrAdminOf(user, team): the live team is read
    /// globally (missing → Msg.Team.adminNotAllowed failure); the user must
    /// manage the team or administer its organization. Team-manager roles
    /// only count for teams of the user's organization.
    async fn is_team_manager_or_admin_of(
        &self,
        user: &AuthUser,
        team_id: &ObjectId,
    ) -> Result<bool, ProviderError> {
        let team = crate::annotation::annotation_dao::find_team_with_manager_flag(
            &self.pool, user, team_id,
        )
        .await?;
        let (organization, manages) =
            team.ok_or_else(|| ProviderError::failure(crate::msg::team::ADMIN_NOT_ALLOWED))?;
        Ok(organization == user.organization_id && (manages || user.is_admin))
    }

    /// AnnotationInformationHandler.registerDataSourceInTemporaryStore: the
    /// live dataset (global access) as usable data source, stored under the
    /// temporary annotation (= parent) ID.
    async fn register_data_source(
        &self,
        temporary_annotation_id: &ObjectId,
        dataset_id: &ObjectId,
    ) -> Result<(), ProviderError> {
        let dataset =
            annotation_provider_dao::find_dataset_usability(&self.pool, dataset_id).await?;
        let (usable, has_voxel_size) = dataset.ok_or_else(|| {
            ProviderError::failure(crate::msg::dataset::not_found_for_annotation(
                dataset_id,
                temporary_annotation_id,
            ))
        })?;
        if !usable {
            return Err(ProviderError::failure(crate::msg::dataset::not_usable(
                dataset_id,
            )));
        }
        if !has_voxel_size {
            return Err(ProviderError::Failure(FoxFailure {
                message: crate::msg::dataset::data_source::NOT_FOUND.to_owned(),
                chain: vec![crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE.to_owned()],
                status: Some(StatusCode::NOT_FOUND),
            }));
        }
        let data_source =
            crate::dataset::routes::data_source_for_rpc(&self.pool, dataset_id, true).await?;
        self.data_sources.store(
            temporary_annotation_id.clone(),
            data_source,
            dataset_id.clone(),
        );
        Ok(())
    }

    /// TaskDAO.findTaskBoundingBoxesByAnnotationIds (no access predicate).
    async fn task_bounding_boxes(
        &self,
        annotation_ids: &[ObjectId],
    ) -> Result<Vec<NamedBoundingBox>, ProviderError> {
        let rows = annotation_provider_dao::find_task_bounding_boxes_by_annotation_ids(
            &self.pool,
            annotation_ids,
        )
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
                bounding_box: BoundingBox::new(Vec3Int::new(x, y, z), width, height, depth),
            });
        }
        Ok(boxes)
    }
}
