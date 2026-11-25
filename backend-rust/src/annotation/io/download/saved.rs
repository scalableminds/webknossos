//! Saved annotations: a zip with the NML, volume data and edited-mapping zips, and bookmark
//! thumbnails.

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::{http::StatusCode, response::Response};
use futures_util::{StreamExt, stream};

use crate::{
    annotation::access::AnnotationMetadata,
    annotation::nml::bookmarks::{
        BookmarkThumbnailSize, NmlAnnotationBookmarkToWrite, thumbnail_location,
    },
    annotation::nml::writer::{
        NmlAnnotation, NmlLayer, NmlLayerTracing, NmlVoxelSize, NmlWriteInput,
        edited_mapping_edges_zip_name, volume_data_zip_name, write_nml,
    },
    annotation::provider::{AccessContext, AnnotationIdentifier, RESTRICTIONS_NOT_FOUND},
    job::submission::{Failure, RunError, RunResult},
    proto::{AnnotationUserStateProto, SkeletonTracing},
    stores::tracing_client::{FetchedVolumeLayer, VolumeLayerFetch, find_first_tracing_store_url},
    util::id::ObjectId,
};

use super::{
    archive::{ZipEntry, file_response, zip_entries},
    failure::{fail, provider_failure, rpc_failure},
    lookups::{DatasetRow, LayerRow, find_multi_user, find_user_multi_user},
    naming::{java_url_encode_path, name_for},
    params::{Context, DownloadParams},
    {
        DOWNLOAD_NOT_ALLOWED, FETCH_BOOKMARKS_FAILED, FETCH_SKELETON_LAYER_FAILED,
        FETCH_VOLUME_LAYER_FAILED, FIND_USER_FAILED, TASK_NOT_FOUND, WRITE_TO_FILE_FAILED,
        ZIP_MIME_TYPE, ZIP_NML_FAILED, annotation_download_dao,
    },
};

/// Everything the NML writer needs about the annotation's surroundings.
struct SavedDownload<'a> {
    annotation: &'a AnnotationMetadata,
    layers: Vec<LayerRow>,
    dataset: DatasetRow,
    voxel_size: Option<NmlVoxelSize>,
    tracing_store_url: String,
    name: String,
    params: &'a DownloadParams,
}

/// downloadExplorational (saved annotations of any non-View, non-compound type).
pub(super) async fn download_saved(
    context: &Context<'_>,
    identifier: &AnnotationIdentifier,
    params: &DownloadParams,
) -> RunResult<Response> {
    let access = AccessContext::requester(context.user);
    let typ = identifier.annotation_type.as_str();
    let id = &identifier.identifier;
    // provideAnnotation(typ, id, user) ~> NOT_FOUND
    let provided = context
        .services
        .provider
        .provide(access, typ, id)
        .await
        .map_err(|error| match provider_failure(error) {
            RunError::Failure(_) => Failure::with_status(
                crate::msg::annotation::NOT_FOUND.to_owned(),
                StatusCode::NOT_FOUND,
            )
            .into(),
            api => api,
        })?;
    let Some(annotation) = provided.saved() else {
        return Err(fail(crate::msg::annotation::NOT_FOUND));
    };
    let restrictions = context
        .services
        .provider
        .restrictions_for(access, identifier)
        .await
        .map_err(|error| provider_failure(error).wrap(RESTRICTIONS_NOT_FOUND))?;
    let name = name_for(context, annotation).await?;
    let layers = annotation_download_dao::find_all_layers(context.pool(), &annotation.id).await?;
    // Fox.assertTrue(restrictions.allowDownload(user)) ?~> notAllowed ~> FORBIDDEN.
    if !restrictions.allow_download {
        return Err(Failure::with_status(DOWNLOAD_NOT_ALLOWED, StatusCode::FORBIDDEN).into());
    }
    let dataset = annotation_download_dao::find_dataset(context.pool(), &annotation.dataset_id)
        .await?
        .ok_or_else(|| {
            RunError::from(Failure::with_status(
                crate::msg::dataset::not_found_for_annotation(
                    &annotation.dataset_id,
                    &annotation.id,
                ),
                StatusCode::NOT_FOUND,
            ))
        })?;
    if !crate::organization::organization_dao::exists(context.pool(), &dataset.organization).await?
    {
        return Err(Failure::with_status(
            crate::msg::organization::not_found(&dataset.organization),
            StatusCode::NOT_FOUND,
        )
        .into());
    }
    let file_name = java_url_encode_path(&format!("{name}.zip"));
    let download = SavedDownload {
        annotation,
        layers,
        voxel_size: dataset.voxel_size(),
        dataset,
        tracing_store_url: String::new(),
        name,
        params,
    };
    let bytes = annotation_to_file(context, download)
        .await
        .map_err(|error| error.wrap(WRITE_TO_FILE_FAILED))?;
    Ok(file_response(
        bytes,
        ZIP_MIME_TYPE,
        format!("attachment; filename=\"{file_name}\""),
    ))
}

/// annotationToTemporaryFile.
async fn annotation_to_file(
    context: &Context<'_>,
    mut download: SavedDownload<'_>,
) -> RunResult<Vec<u8>> {
    // tracingStoreService.clientFor(dataset)
    let url = find_first_tracing_store_url(context.pool())
        .await?
        .ok_or_else(|| fail(crate::msg::tracing_store::NOT_FOUND))?;
    download.tracing_store_url = url;
    write_zip(context, &download).await
}

/// fetchBookmarksWithThumbnails: bookmark thumbnails are optional, missing ones are skipped. One
/// request per thumbnail, so several are made at once (`Fox.batchCombined`, parallelity 8).
async fn fetch_bookmarks_with_thumbnails(
    context: &Context<'_>,
    download: &SavedDownload<'_>,
) -> RunResult<Vec<NmlAnnotationBookmarkToWrite>> {
    let tracing_store = &context.services.tracing_store;
    let annotation_id = &download.annotation.id;
    let bookmarks = tracing_store
        .get_bookmarks(
            &download.tracing_store_url,
            annotation_id,
            download.params.version,
        )
        .await
        .map_err(rpc_failure)?;
    let requests: Vec<(usize, BookmarkThumbnailSize)> = (0..bookmarks.len())
        .flat_map(|index| BookmarkThumbnailSize::VALUES.map(|size| (index, size)))
        .collect();
    let fetched: Vec<(usize, BookmarkThumbnailSize, Option<Vec<u8>>)> = stream::iter(requests)
        .map(|(index, size)| {
            let bookmark = &bookmarks[index];
            async move {
                let thumbnail = tracing_store
                    .get_bookmark_thumbnail(
                        &download.tracing_store_url,
                        annotation_id,
                        bookmark,
                        size,
                    )
                    .await;
                (index, size, thumbnail)
            }
        })
        .buffered(8)
        .collect()
        .await;
    // Grouped by bookmark id, like Scala, so bookmarks with equal ids share their thumbnails.
    let mut thumbnails_by_id: HashMap<i32, BTreeMap<BookmarkThumbnailSize, Vec<u8>>> =
        HashMap::new();
    for (index, size, thumbnail) in fetched {
        if let Some(thumbnail) = thumbnail {
            thumbnails_by_id
                .entry(bookmarks[index].id)
                .or_default()
                .insert(size, thumbnail);
        }
    }
    Ok(bookmarks
        .into_iter()
        .map(|bookmark| NmlAnnotationBookmarkToWrite {
            thumbnails: thumbnails_by_id
                .get(&bookmark.id)
                .cloned()
                .unwrap_or_default(),
            bookmark,
        })
        .collect())
}

async fn fetch_skeleton_layers(
    context: &Context<'_>,
    download: &SavedDownload<'_>,
) -> RunResult<Vec<(LayerRow, SkeletonTracing)>> {
    let mut fetched = Vec::new();
    for layer in download
        .layers
        .iter()
        .filter(|layer| layer.typ == "Skeleton")
    {
        let tracing = context
            .services
            .tracing_store
            .get_skeleton_tracing(
                &download.tracing_store_url,
                &layer.tracing_id,
                &download.annotation.id,
                download.params.version,
            )
            .await
            .map_err(rpc_failure)?;
        fetched.push((layer.clone(), tracing));
    }
    Ok(fetched)
}

struct NmlContext<'a> {
    user_states: &'a [AnnotationUserStateProto],
    owner_name: &'a str,
    task_id: Option<&'a ObjectId>,
    bookmarks: &'a [NmlAnnotationBookmarkToWrite],
    dataset_layer_names: &'a HashSet<String>,
}

fn nml_input<'a>(
    context: &'a Context<'_>,
    download: &'a SavedDownload<'_>,
    layers: Vec<NmlLayer<'a>>,
    nml: &NmlContext<'a>,
) -> NmlWriteInput<'a> {
    let config = &context.services.misc.0.config;
    NmlWriteInput {
        layers,
        annotation_user_states: nml.user_states,
        requesting_user_id: context.user.map(|user| &user.id),
        annotation_owner_id: &download.annotation.owner_id,
        annotation_owner_name: nml.owner_name,
        annotation: Some(NmlAnnotation {
            id: &download.annotation.id,
            description: &download.annotation.description,
            has_task: download.annotation.task_id.is_some(),
        }),
        task_id: nml.task_id,
        voxel_size: download.voxel_size.as_ref(),
        volume_filename: None,
        organization_id: &download.dataset.organization,
        wk_url: &config.public_uri,
        dataset_name: &download.dataset.name,
        dataset_id: &download.dataset.id,
        skip_volume_data: download.params.skip_volume_data,
        volume_data_zip_format: download.params.volume_data_zip_format,
        writer_git_commit: &config.build_info.commit_hash,
        timestamp_millis: chrono::Utc::now().timestamp_millis(),
        bookmarks: nml.bookmarks,
        dataset_layer_names: Some(nml.dataset_layer_names),
    }
}

/// The zip of annotationToTemporaryFile: `<name>.nml` (default deflate), then per volume layer
/// its data zip and edited-edges zip (BEST_SPEED), then the bookmark thumbnails (at the level
/// the zipper was left at).
async fn write_zip(context: &Context<'_>, download: &SavedDownload<'_>) -> RunResult<Vec<u8>> {
    let annotation_id = &download.annotation.id;
    let tracing_store = &context.services.tracing_store;
    let mut volumes: Vec<(LayerRow, FetchedVolumeLayer)> = Vec::new();
    let fetched_volumes: RunResult<()> = async {
        for layer in download.layers.iter().filter(|layer| layer.typ == "Volume") {
            let fetched = tracing_store
                .fetch_volume_layer(
                    &download.tracing_store_url,
                    VolumeLayerFetch {
                        tracing_id: &layer.tracing_id,
                        annotation_id,
                        version: download.params.version,
                        skip_volume_and_edges_data: download.params.skip_volume_data,
                        volume_data_zip_format: download.params.volume_data_zip_format,
                        voxel_size: download.voxel_size.as_ref(),
                    },
                )
                .await
                .map_err(rpc_failure)?;
            volumes.push((layer.clone(), fetched));
        }
        Ok(())
    }
    .await;
    fetched_volumes.map_err(|error| error.wrap(FETCH_VOLUME_LAYER_FAILED))?;
    let skeletons = fetch_skeleton_layers(context, download)
        .await
        .map_err(|error| error.wrap(FETCH_SKELETON_LAYER_FAILED))?;
    let multi_user = find_user_multi_user(context.pool(), &download.annotation.owner_id)
        .await?
        .ok_or_else(|| fail(FIND_USER_FAILED))?;
    let owner_name = find_multi_user(context.pool(), &multi_user, true)
        .await?
        .map(|(first, last)| format!("{first} {last}"))
        .ok_or_else(|| fail(crate::msg::user::NOT_FOUND_NO_ID))?;
    let task_id = match &download.annotation.task_id {
        Some(task_id) => {
            if !annotation_download_dao::task_exists(context.pool(), task_id, None).await? {
                return Err(fail(TASK_NOT_FOUND));
            }
            Some(task_id)
        }
        None => None,
    };
    let proto = tracing_store
        .get_annotation_proto(
            &download.tracing_store_url,
            annotation_id,
            download.params.version,
        )
        .await
        .map_err(rpc_failure)?;
    let bookmarks = fetch_bookmarks_with_thumbnails(context, download)
        .await
        .map_err(|error| error.wrap(FETCH_BOOKMARKS_FAILED))?;
    let dataset_layer_names: HashSet<String> =
        annotation_download_dao::find_dataset_layer_names(context.pool(), &download.dataset.id)
            .await?
            .into_iter()
            .collect();
    let mut layers: Vec<NmlLayer<'_>> = skeletons
        .iter()
        .map(|(layer, tracing)| NmlLayer {
            tracing_id: &layer.tracing_id,
            name: &layer.name,
            tracing: NmlLayerTracing::Skeleton(tracing),
            has_edited_mapping_edges: false,
            base_mapping_name: None,
        })
        .collect();
    layers.extend(volumes.iter().map(|(layer, fetched)| NmlLayer {
        tracing_id: &layer.tracing_id,
        name: &layer.name,
        tracing: NmlLayerTracing::Volume(&fetched.tracing),
        has_edited_mapping_edges: fetched.edited_mapping_edges.is_some(),
        base_mapping_name: fetched.base_mapping_name.as_deref(),
    }));
    let nml = NmlContext {
        user_states: &proto.user_states,
        owner_name: &owner_name,
        task_id,
        bookmarks: &bookmarks,
        dataset_layer_names: &dataset_layer_names,
    };
    let document = write_nml(&nml_input(context, download, layers, &nml))
        .map_err(|error| fail(error.to_string()).wrap(ZIP_NML_FAILED))?;
    let is_single = volumes.len() == 1;
    let mut entries: Vec<ZipEntry<'_>> = vec![ZipEntry {
        name: format!("{}.nml", download.name),
        bytes: document.as_bytes(),
        fast: false,
    }];
    for (index, (layer, fetched)) in volumes.iter().enumerate() {
        if let Some(data) = &fetched.data {
            entries.push(ZipEntry {
                name: volume_data_zip_name(&layer.name, index, is_single),
                bytes: data,
                fast: true,
            });
        }
        if let Some(edges) = &fetched.edited_mapping_edges {
            entries.push(ZipEntry {
                name: edited_mapping_edges_zip_name(&layer.name, index, is_single),
                bytes: edges,
                fast: true,
            });
        }
    }
    // Scala sets BEST_SPEED before each volume entry and never resets it.
    let fast = entries.len() > 1;
    let thumbnails: Vec<(String, &[u8])> = bookmarks
        .iter()
        .flat_map(|bookmark_to_write| {
            bookmark_to_write
                .thumbnails
                .iter()
                .map(|(size, thumbnail)| {
                    (
                        thumbnail_location(bookmark_to_write.bookmark.id, *size),
                        thumbnail.as_slice(),
                    )
                })
        })
        .collect();
    entries.extend(
        thumbnails
            .into_iter()
            .map(|(name, bytes)| ZipEntry { name, bytes, fast }),
    );
    zip_entries(&entries).map_err(|_| fail(ZIP_NML_FAILED))
}
