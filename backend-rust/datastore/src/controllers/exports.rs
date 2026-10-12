//! ExportsController (job export downloads) and DSAiModelController (model voxel size).
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::stream;
use serde_json::Value;
use tokio::io::AsyncReadExt;

use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    datavault::ByteRange,
    error::DsError,
    models::{UPath, Vec3Double, VoxelSize},
};

use super::helpers::{dataset_id, validated_body};

const STATISTICS_JSON: &str = "statistics.json";

pub fn router() -> Router<AppState> {
    controller(
        Router::new().route("/data/exports/{jobId}/download", get(download)),
        true,
    )
    .merge(controller(
        Router::new().route(
            "/data/aiModels/effectiveVoxelSize",
            post(effective_voxel_size),
        ),
        false,
    ))
}

/// Play `HttpHeaderParameterEncoding.encode("filename", name)`: an ASCII quoted value with `?`
/// for other characters, plus an RFC 5987 `filename*` when needed.
pub fn content_disposition_attachment(name: &str) -> String {
    let mut out = String::from("attachment; filename=\"");
    let mut extended = false;
    for c in name.chars() {
        match c {
            '"' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            ' ' | '\t' | '!'..='~' => out.push(c),
            _ => {
                out.push('?');
                extended = true;
            }
        }
    }
    out.push('"');
    if extended {
        out.push_str("; filename*=utf-8''");
        for b in name.bytes() {
            if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// Play `MimeTypes.forFileName` for the formats exports produce; everything else is binary.
fn mime_type(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "zip" => "application/zip",
        "tif" | "tiff" => "image/tiff",
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        _ => "application/octet-stream",
    }
}

async fn download(
    State(state): State<AppState>,
    tc: TokenContext,
    Path(job_id): Path<String>,
) -> AccessResult<Response> {
    let job_id = dataset_id(&job_id).map_err(|_| {
        DsError::failure(format!(
            "Cannot parse URI path parameter jobId with value “{job_id}” as ObjectId."
        ))
    })?;
    state
        .access
        .validate_access(UserAccessRequest::download_job_export(&job_id), &tc)
        .await?;
    let properties = state.wk_client.get_job_export_properties(&job_id).await?;
    let bases = state.base_dirs.clone();
    let organization = properties.organization_id.clone();
    let orga_dir = tokio::task::spawn_blocking(move || {
        bases.get_one_local_for_org(&organization, false, false, false)
    })
    .await
    .map_err(DsError::from_exception)??;
    let full_path = properties.full_path_in(&orga_dir);
    let file = match tokio::fs::File::open(&full_path).await {
        Ok(file) if full_path.is_file() => file,
        _ => {
            return Err(
                DsError::failure("Exported file not found. The link may be expired.").into(),
            );
        }
    };
    let length = file
        .metadata()
        .await
        .map_err(DsError::from_exception)?
        .len();
    let name = full_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let body = Body::from_stream(stream::unfold(file, |mut file| async move {
        let mut buffer = vec![0u8; 64 * 1024];
        match file.read(&mut buffer).await {
            Ok(0) => None,
            Ok(n) => {
                buffer.truncate(n);
                Some((Ok::<_, std::io::Error>(buffer), file))
            }
            Err(e) => Some((Err(e), file)),
        }
    }));
    let mut response = body.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(mime_type(&name)),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    if let Ok(value) = HeaderValue::from_str(&content_disposition_attachment(&name)) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

async fn effective_voxel_size(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let model_path = match validated_body(body, |v| {
        let mut fields = crate::models::json::Fields::new(v);
        let path = fields.req("modelPath", UPath::from_json);
        fields.finish()?;
        path
    }) {
        Ok(path) => path,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(UserAccessRequest::webknossos(), &tc)
        .await?;
    let model = state.data_vaults.vault_path_for(&model_path).await?;
    let bytes = model
        .join("model")
        .join(STATISTICS_JSON)
        .read_bytes(ByteRange::Complete, tc.user_token.as_deref())
        .await
        .map_err(|e| {
            DsError::from(e.wrap(format!("Could not read model {STATISTICS_JSON} info file.")))
        })?;
    let parse_failed =
        || format!("Could not parse model {STATISTICS_JSON} – is the scale attribute missing?");
    let json: Value = serde_json::from_slice(&bytes)
        .map_err(|e| DsError::failure(e.to_string()).wrap(parse_failed()))?;
    let scale = crate::models::json::lookup(&json, "scale", Vec3Double::from_json)
        .map_err(|e| DsError::failure(e.validation_failure_message()).wrap(parse_failed()))?;
    Ok(Json(VoxelSize::from_factor_with_default_unit(scale)).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition_like_play() {
        assert_eq!(
            content_disposition_attachment("export.zip"),
            "attachment; filename=\"export.zip\""
        );
        assert_eq!(
            content_disposition_attachment("a\"b.zip"),
            "attachment; filename=\"a\\\"b.zip\""
        );
        assert_eq!(
            content_disposition_attachment("naïve 1.tif"),
            "attachment; filename=\"na?ve 1.tif\"; filename*=utf-8''na%C3%AFve%201.tif"
        );
    }
}
