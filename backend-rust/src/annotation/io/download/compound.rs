//! Compound annotations: zips of the finished Task annotations of a project, task or task type.
use std::io::Cursor;

use axum::{http::StatusCode, response::Response};
use sqlx::PgPool;
use zip::ZipWriter;

use crate::{
    annotation::nml::writer::{
        NmlAnnotation, NmlLayer, NmlLayerTracing, NmlVoxelSize, NmlWriteInput, VolumeDataZipFormat,
        write_nml,
    },
    annotation::provider::AnnotationType,
    auth::AuthUser,
    job::submission::{Failure, RunError, RunResult},
    proto::{SkeletonTracing, VolumeTracing},
    stores::tracing_client::find_first_tracing_store_url,
    util::id::ObjectId,
};

use super::{
    archive::{ZipEntry, add_zip_entry, file_response, zip_entries},
    failure::{empty, fail, not_allowed, rpc_failure},
    lookups::{LayerRow, find_multi_user},
    naming::{AnnotationNameParts, name_for_annotation, normalize, play_header_parameter},
    params::Context,
    {
        MISMATCHING_SKELETON, MISMATCHING_VOLUME, NEEDS_SKELETON_OR_VOLUME, TASK_NOT_FOUND,
        VIEW_NOT_DOWNLOADABLE, ZIP_MIME_TYPE, ZIP_NML_FAILED, annotation_download_dao,
    },
};

/// A finished Task annotation of a compound download.
#[derive(Debug, Clone, sqlx::FromRow)]
pub(super) struct CompoundRow {
    id: ObjectId,
    dataset_id: ObjectId,
    task_id: Option<ObjectId>,
    owner_id: ObjectId,
    description: String,
}

/// downloadProject / downloadTask / downloadTaskType: a logged-in team
/// manager or administrator of the parent's team receives a zip of the
/// finished Task annotations (`AnnotationService.zipAnnotations`).
pub(super) async fn download_compound(
    context: &Context<'_>,
    typ: AnnotationType,
    id: &ObjectId,
    skip_volume_data: bool,
) -> RunResult<Response> {
    let user = context.user.ok_or_else(not_allowed)?;
    let pool = context.pool();
    let (annotations, zip_name) = match typ {
        AnnotationType::CompoundProject => {
            let (team, name) = annotation_download_dao::find_project(pool, user, id)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::project::not_found(id),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            (
                annotation_download_dao::finished_project_annotations(pool, id).await?,
                name,
            )
        }
        AnnotationType::CompoundTask => {
            let project = annotation_download_dao::find_task_project(pool, user, id)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::task::not_found(id),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            let (team, _) = annotation_download_dao::find_project(pool, user, &project)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::project::not_found(&project),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            (
                annotation_download_dao::finished_task_annotations(
                    pool,
                    user,
                    std::slice::from_ref(id),
                )
                .await?,
                id.to_string(),
            )
        }
        AnnotationType::CompoundTaskType => {
            let (team, summary) = annotation_download_dao::find_task_type(pool, user, id)
                .await?
                .ok_or_else(|| {
                    RunError::from(Failure::with_status(
                        crate::msg::task_type::not_found(id),
                        StatusCode::NOT_FOUND,
                    ))
                })?;
            assert_team_manager_or_admin(pool, user, &team).await?;
            let tasks = annotation_download_dao::task_type_tasks(pool, user, id).await?;
            (
                annotation_download_dao::finished_task_annotations(pool, user, &tasks).await?,
                summary,
            )
        }
        _ => return Err(fail(VIEW_NOT_DOWNLOADABLE)),
    };
    let bytes = zip_annotations(context, user, &annotations, skip_volume_data).await?;
    let file_name = normalize(&format!("{zip_name}_nmls.zip"));
    Ok(file_response(
        bytes,
        ZIP_MIME_TYPE,
        format!(
            "attachment; {}",
            play_header_parameter("filename", &file_name)
        ),
    ))
}

/// `Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, team)) ?~>
/// notAllowed ~> FORBIDDEN`. A missing team is Msg.Team.adminNotAllowed
/// (kept as cause); team-manager roles count only inside the user's
/// organization.
async fn assert_team_manager_or_admin(
    pool: &PgPool,
    user: &AuthUser,
    team_id: &ObjectId,
) -> RunResult<()> {
    let team =
        crate::annotation::annotation_dao::find_team_with_manager_flag(pool, user, team_id).await?;
    match team {
        None => Err(Failure::new(crate::msg::team::ADMIN_NOT_ALLOWED)
            .wrap(crate::msg::NOT_ALLOWED)
            .with_param(StatusCode::FORBIDDEN)
            .into()),
        Some((organization, manages))
            if organization == user.organization_id && (manages || user.is_admin) =>
        {
            Ok(())
        }
        Some(_) => Err(not_allowed()),
    }
}

/// Annotation.skeletonTracingId / volumeTracingId: at most one layer of the
/// kind (else Msg.Annotation.multiLayers*NotImplemented).
fn single_tracing_id(layers: &[LayerRow], typ: &str, message: &str) -> RunResult<Option<String>> {
    let mut matching = layers.iter().filter(|layer| layer.typ == typ);
    let first = matching.next().map(|layer| layer.tracing_id.clone());
    if matching.next().is_some() {
        return Err(fail(message));
    }
    Ok(first)
}

/// AnnotationService.DownloadAnnotation after getTracingsScalesAndNamesFor.
struct DownloadAnnotation<'a> {
    row: &'a CompoundRow,
    skeleton_id: Option<String>,
    volume_id: Option<String>,
    skeleton: Option<SkeletonTracing>,
    volume: Option<VolumeTracing>,
    volume_data: Option<Vec<u8>>,
    name: String,
    voxel_size: Option<NmlVoxelSize>,
    owner_name: String,
    task_id: Option<&'a ObjectId>,
    organization_id: String,
    dataset_name: String,
    dataset_id: ObjectId,
}

/// getTracingsScalesAndNamesFor for one dataset group: scale, tracing ids,
/// getMultiple skeletons/volumes, volume data, then per-annotation lookups.
/// Lists are zipped like Scala (a shorter tracing-store answer truncates).
async fn download_annotations_for_dataset<'a>(
    context: &Context<'_>,
    user: &AuthUser,
    dataset_id: &ObjectId,
    group: &[&'a CompoundRow],
    skip_volume_data: bool,
) -> RunResult<Vec<DownloadAnnotation<'a>>> {
    let pool = context.pool();
    let tracing_store = &context.services.tracing_store;
    let dataset = annotation_download_dao::find_readable_dataset(pool, user, dataset_id)
        .await?
        .ok_or_else(empty)?;
    let voxel_size = dataset.voxel_size();
    let mut layers = Vec::with_capacity(group.len());
    for row in group {
        layers.push(annotation_download_dao::find_all_layers(pool, &row.id).await?);
    }
    let skeleton_ids = layers
        .iter()
        .map(|layers| {
            single_tracing_id(
                layers,
                "Skeleton",
                crate::msg::annotation::MULTI_LAYERS_SKELETON_NOT_IMPLEMENTED,
            )
        })
        .collect::<RunResult<Vec<_>>>()?;
    let volume_ids = layers
        .iter()
        .map(|layers| {
            single_tracing_id(
                layers,
                "Volume",
                crate::msg::annotation::MULTI_LAYERS_VOLUME_NOT_IMPLEMENTED,
            )
        })
        .collect::<RunResult<Vec<_>>>()?;
    let url = find_first_tracing_store_url(pool)
        .await?
        .ok_or_else(|| fail(crate::msg::tracing_store::NOT_FOUND))?;
    let skeletons = tracing_store
        .get_skeleton_tracings(&url, &skeleton_ids)
        .await
        .map_err(rpc_failure)?;
    let volumes = tracing_store
        .get_volume_tracings(&url, &volume_ids)
        .await
        .map_err(rpc_failure)?;
    let mut volume_data = Vec::with_capacity(volume_ids.len());
    for volume_id in &volume_ids {
        volume_data.push(match volume_id {
            Some(tracing_id) if !skip_volume_data => Some(
                tracing_store
                    .get_volume_data(
                        &url,
                        tracing_id,
                        VolumeDataZipFormat::Wkw,
                        voxel_size.as_ref(),
                    )
                    .await
                    .map_err(|error| rpc_failure(error.into()))?,
            ),
            _ => None,
        });
    }
    let mut incomplete = Vec::with_capacity(group.len());
    for (row, (skeleton_id, volume_id)) in
        group.iter().zip(skeleton_ids.into_iter().zip(volume_ids))
    {
        incomplete.push(
            single_download_annotation(
                context,
                user,
                row,
                skeleton_id,
                volume_id,
                voxel_size.clone(),
            )
            .await?,
        );
    }
    Ok(incomplete
        .into_iter()
        .zip(skeletons)
        .zip(volumes)
        .zip(volume_data)
        .map(|(((mut annotation, skeleton), volume), data)| {
            annotation.skeleton = skeleton;
            annotation.volume = volume;
            annotation.volume_data = data;
            annotation
        })
        .collect())
}

/// getSingleDownloadAnnotation (requester access context).
async fn single_download_annotation<'a>(
    context: &Context<'_>,
    user: &AuthUser,
    row: &'a CompoundRow,
    skeleton_id: Option<String>,
    volume_id: Option<String>,
    voxel_size: Option<NmlVoxelSize>,
) -> RunResult<DownloadAnnotation<'a>> {
    let pool = context.pool();
    // userService.findOneCached under UserDAO read access ?~> Msg.User.notFound
    let multi_user =
        annotation_download_dao::find_multi_user_id_readable(pool, user, &row.owner_id).await?;
    let multi_user = multi_user.ok_or_else(|| fail(crate::msg::user::NOT_FOUND_NO_ID))?;
    let owner_name = find_multi_user(pool, &multi_user, true)
        .await?
        .map(|(first, last)| format!("{first} {last}"))
        .ok_or_else(empty)?;
    let task_id = match &row.task_id {
        Some(task_id) => {
            if !annotation_download_dao::task_exists(pool, task_id, Some(Some(user))).await? {
                return Err(fail(TASK_NOT_FOUND));
            }
            Some(task_id)
        }
        None => None,
    };
    let parts = AnnotationNameParts {
        id: &row.id,
        owner_id: &row.owner_id,
        dataset_id: &row.dataset_id,
        task_id: row.task_id.as_ref(),
    };
    let name = name_for_annotation(pool, parts, true)
        .await?
        .ok_or_else(empty)?;
    let dataset = annotation_download_dao::find_readable_dataset(pool, user, &row.dataset_id)
        .await?
        .ok_or_else(empty)?;
    let organization_id =
        annotation_download_dao::find_organization_id_for_annotation(pool, &row.id)
            .await?
            .ok_or_else(empty)?;
    Ok(DownloadAnnotation {
        row,
        skeleton_id,
        volume_id,
        skeleton: None,
        volume: None,
        volume_data: None,
        name,
        voxel_size,
        owner_name,
        task_id,
        organization_id,
        dataset_name: dataset.name,
        dataset_id: dataset.id,
    })
}

/// AnnotationService.zipAnnotations + createZip: per annotation `<name>.nml`,
/// or `<name>.zip` holding `<name>_data.zip` and `<name>.nml` when volume
/// data was fetched. Annotations are grouped by dataset (first appearance).
async fn zip_annotations(
    context: &Context<'_>,
    user: &AuthUser,
    annotations: &[CompoundRow],
    skip_volume_data: bool,
) -> RunResult<Vec<u8>> {
    let mut groups: Vec<(&ObjectId, Vec<&CompoundRow>)> = Vec::new();
    for row in annotations {
        match groups
            .iter_mut()
            .find(|(dataset, _)| **dataset == row.dataset_id)
        {
            Some((_, group)) => group.push(row),
            None => groups.push((&row.dataset_id, vec![row])),
        }
    }
    let mut downloads = Vec::with_capacity(annotations.len());
    for (dataset_id, group) in &groups {
        downloads.extend(
            download_annotations_for_dataset(context, user, dataset_id, group, skip_volume_data)
                .await?,
        );
    }
    let config = &context.services.misc.0.config;
    let mut rendered: Vec<(String, String, Option<Vec<u8>>)> = Vec::with_capacity(downloads.len());
    for download in downloads {
        // FetchedAnnotationLayer.layersFromTracings
        if download.skeleton_id.is_some() != download.skeleton.is_some() {
            return Err(fail(MISMATCHING_SKELETON));
        }
        if download.volume_id.is_some() != download.volume.is_some() {
            return Err(fail(MISMATCHING_VOLUME));
        }
        let mut layers = Vec::with_capacity(2);
        if let (Some(tracing_id), Some(tracing)) = (&download.skeleton_id, &download.skeleton) {
            layers.push(NmlLayer {
                tracing_id,
                name: "Skeleton",
                tracing: NmlLayerTracing::Skeleton(tracing),
                has_edited_mapping_edges: false,
                base_mapping_name: None,
            });
        }
        if let (Some(tracing_id), Some(tracing)) = (&download.volume_id, &download.volume) {
            layers.push(NmlLayer {
                tracing_id,
                name: "Volume",
                tracing: NmlLayerTracing::Volume(tracing),
                has_edited_mapping_edges: false,
                base_mapping_name: None,
            });
        }
        if layers.is_empty() {
            return Err(fail(NEEDS_SKELETON_OR_VOLUME));
        }
        let volume_filename = format!("{}_data.zip", download.name);
        let document = write_nml(&NmlWriteInput {
            layers,
            annotation_user_states: &[],
            requesting_user_id: None,
            annotation_owner_id: &download.row.owner_id,
            annotation_owner_name: &download.owner_name,
            annotation: Some(NmlAnnotation {
                id: &download.row.id,
                description: &download.row.description,
                has_task: download.row.task_id.is_some(),
            }),
            task_id: download.task_id,
            voxel_size: download.voxel_size.as_ref(),
            volume_filename: Some(&volume_filename),
            organization_id: &download.organization_id,
            wk_url: &config.public_uri,
            dataset_name: &download.dataset_name,
            dataset_id: &download.dataset_id,
            skip_volume_data,
            volume_data_zip_format: VolumeDataZipFormat::Wkw,
            writer_git_commit: &config.build_info.commit_hash,
            timestamp_millis: chrono::Utc::now().timestamp_millis(),
        })
        .map_err(|error| fail(error.to_string()))?;
        rendered.push((download.name, document, download.volume_data));
    }
    let mut outer = ZipWriter::new(Cursor::new(Vec::new()));
    let zip_error = |_| fail(ZIP_NML_FAILED);
    for (name, document, volume_data) in &rendered {
        match volume_data {
            Some(data) => {
                let inner = zip_entries(&[
                    ZipEntry {
                        name: format!("{name}_data.zip"),
                        bytes: data,
                        fast: false,
                    },
                    ZipEntry {
                        name: format!("{name}.nml"),
                        bytes: document.as_bytes(),
                        fast: false,
                    },
                ])
                .map_err(zip_error)?;
                add_zip_entry(&mut outer, &format!("{name}.zip"), &inner).map_err(zip_error)?;
            }
            None => {
                add_zip_entry(&mut outer, &format!("{name}.nml"), document.as_bytes())
                    .map_err(zip_error)?;
            }
        }
    }
    Ok(outer.finish().map_err(zip_error)?.into_inner())
}
