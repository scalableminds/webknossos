//! AnnotationIOController.download (`GET /annotations/:typ/:id/download`) and
//! downloadWithoutType (`GET /annotations/:id/download`): a saved annotation
//! as NML (skeleton only) or as a zip holding the NML plus the volume data and
//! edited-mapping zips; compound project/task/task-type annotations as a zip
//! of the finished annotations' NMLs (with nested volume zips).
//!
//! Both are UserAwareActions (anonymous requesters may download what they can
//! read). Responses are buffered in memory (Scala writes a temporary file).
mod annotation_download_dao;
mod archive;
mod compound;
mod failure;
mod lookups;
mod naming;
mod params;
mod saved;

use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Map, Value};

use crate::{
    AppState,
    annotation::provider::{AccessContext, AnnotationIdentifier, AnnotationType},
    auth::OptionalAuthUser,
    extract::Path,
    job::submission::{Failure, RunResult},
    util::id::ObjectId,
};

use compound::download_compound;
use failure::{RunErrorExt, provider_failure};
pub use naming::play_header_parameter;
use params::{Context, DownloadParams, Services};
use saved::download_saved;

// Msg.Annotation.Download.* and related texts.
pub const DOWNLOAD_FAILED: &str = "Could not download annotation.";
pub const FETCH_VOLUME_LAYER_FAILED: &str = "Could not fetch volume annotation layer.";
pub const FETCH_SKELETON_LAYER_FAILED: &str = "Could not fetch skeleton annotation layer.";
pub const FIND_USER_FAILED: &str = "Could not find or access annotation user.";
pub const ZIP_NML_FAILED: &str = "Could not add NML file to zip archive.";
pub const SKELETON_TO_FILE_FAILED: &str = "Could not write skeleton-only annotation to file.";
pub const HYBRID_TO_FILE_FAILED: &str = "Could not write annotation with volume layer to file.";
pub const DOWNLOAD_NOT_ALLOWED: &str = "You do not have permission to download this annotation.";
pub const WRITE_TO_FILE_FAILED: &str = "Could not write annotation to temporary file for download.";
/// Msg.Annotation.nameNotAvailable.
pub const NAME_NOT_AVAILABLE: &str = "Could not determine name for annotation.";
/// Msg.Task.notFound (without id).
pub const TASK_NOT_FOUND: &str = "Task could not be found or accessed.";
pub const VIEW_NOT_DOWNLOADABLE: &str = "Cannot download View annotation";
pub const MISMATCHING_SKELETON: &str = "Annotation has mismatching skeleton ids and tracings.";
pub const MISMATCHING_VOLUME: &str = "Annotation has mismatching volume ids and tracings.";
pub const NEEDS_SKELETON_OR_VOLUME: &str =
    "Annotation needs at least one skeleton or volume layer.";

const XML_MIME_TYPE: &str = "application/xml";
const ZIP_MIME_TYPE: &str = "application/zip";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/download", get(download))
        .route("/annotations/{id}/download", get(download_without_type))
}

/// GET /annotations/:typ/:id/download?version=&skipVolumeData=&volumeDataZipFormat=
async fn download(
    State(state): State<AppState>,
    services: Services,
    Path((typ, id)): Path<(String, String)>,
    params: DownloadParams,
    OptionalAuthUser(user): OptionalAuthUser,
) -> Response {
    let id = match ObjectId::parse_path(&id) {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let context = Context {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    download_for(&context, &typ, &id, &params)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

/// GET /annotations/:id/download?...: provideAnnotation(id, userOpt)
/// `?~> notFound ~> NOT_FOUND`, then `download` with the STORED type.
async fn download_without_type(
    State(state): State<AppState>,
    services: Services,
    Path(id): Path<String>,
    params: DownloadParams,
    OptionalAuthUser(user): OptionalAuthUser,
) -> Response {
    let id = match ObjectId::parse_path(&id) {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let context = Context {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    let saved = match services
        .provider
        .provide_saved(AccessContext::requester(user.as_ref()), &id)
        .await
    {
        Ok(saved) => saved,
        Err(error) => {
            return provider_failure(error)
                .wrap_status(crate::msg::annotation::NOT_FOUND, StatusCode::NOT_FOUND)
                .into_response();
        }
    };
    download_for(&context, &saved.annotation_type, &id, &params)
        .await
        .unwrap_or_else(IntoResponse::into_response)
}

/// AnnotationIOController.download after binding.
async fn download_for(
    context: &Context<'_>,
    typ: &str,
    id: &ObjectId,
    params: &DownloadParams,
) -> RunResult<Response> {
    let identifier =
        AnnotationIdentifier::parse(typ, id).map_err(|error| Failure::new(error.to_string()))?;
    if let Some(user) = context.user {
        let mut properties = Map::new();
        properties.insert("annotation_id".into(), Value::String(id.to_string()));
        properties.insert("annotation_type".into(), Value::String(typ.to_owned()));
        crate::system::analytics::track(
            context.state,
            &context.services.misc,
            user,
            "download_annotation".into(),
            properties,
        );
    }
    match identifier.annotation_type {
        AnnotationType::View => Err(Failure::new(VIEW_NOT_DOWNLOADABLE).into()),
        AnnotationType::CompoundProject
        | AnnotationType::CompoundTask
        | AnnotationType::CompoundTaskType => {
            download_compound(
                context,
                identifier.annotation_type,
                id,
                params.skip_volume_data,
            )
            .await
        }
        _ => download_saved(context, &identifier, params)
            .await
            .map_err(|error| error.wrap(DOWNLOAD_FAILED)),
    }
}

#[cfg(test)]
mod annotation_download_tests;
