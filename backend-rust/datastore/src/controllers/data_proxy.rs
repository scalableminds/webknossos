//! DataProxyController: mag/attachment byte passthrough and adapted metadata for "virtual" access.
//!
//! Play binds `*path` without URI-decoding it, so the wildcard tail is taken from the raw request
//! path (after the version-alias rewrite) rather than from Axum's decoded `Path` capture.
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};

use crate::{
    AppState,
    access::{AccessResult, AccessTokenService, TokenContext, UserAccessRequest},
    controller,
    datareaders::precomputed::{PrecomputedHeader, header::FILENAME_INFO},
    datavault::{ByteRange, DataVaultService, VaultPath},
    error::{DsError, DsResult},
    models::{LayerAttachmentType, StaticLayer, UPath, UsableDataSource, Vec3Int},
    services::DatasetCache,
};

use super::helpers::dataset_id;

const SOURCE_NOT_FOUND: &str =
    "Data source not found on data store server. It may still be initializing.";

pub fn router() -> Router<AppState> {
    controller(
        Router::new()
            .route(
                "/data/datasets/{datasetId}/proxy/layers/{dataLayerName}/mags/{mag}/{*path}",
                get(proxy_mag),
            )
            .route(
                "/data/datasets/{datasetId}/proxy/layers/{dataLayerName}/mags/info",
                get(proxy_precomputed_info),
            )
            .route(
                "/data/datasets/{datasetId}/proxy/layers/{dataLayerName}/attachments/{attachmentType}/{attachmentName}/{*path}",
                get(proxy_attachment),
            )
            .route(
                "/data/datasets/{datasetId}/proxy/datasource-properties.json",
                get(proxy_datasource),
            ),
        false,
    )
}

/// The undecoded wildcard tail: everything after the first `fixed_segments` path segments.
fn raw_tail(uri: &Uri, fixed_segments: usize) -> String {
    uri.path()
        .splitn(fixed_segments + 2, '/')
        .nth(fixed_segments + 1)
        .unwrap_or_default()
        .to_owned()
}

/// Java's `URLDecoder.decode(path.replace("+", "%2B"), UTF_8)`: every `%` must start a two-digit hex
/// escape; `+` stays literal; malformed UTF-8 is replaced. `None` when not validly encoded.
fn url_decode(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let escape = bytes.get(i + 1..i + 3)?;
            if !escape.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    Some(
        percent_encoding::percent_decode_str(path)
            .decode_utf8_lossy()
            .into_owned(),
    )
}

/// Scala `validatePath`. Wildcard route params are not url-decoded by Play, so the decoded form is
/// validated. Other escapes may be part of real object keys, but encoded “.”, “/” or “\” could form
/// a traversal if decoded again.
fn validate_path(path: &str) -> DsResult<()> {
    let decoded =
        url_decode(path).ok_or_else(|| DsError::failure("path is not validly encoded"))?;
    let lower = decoded.to_ascii_lowercase();
    if ["%2e", "%2f", "%5c"]
        .iter()
        .any(|escape| lower.contains(escape))
    {
        return Err(DsError::failure(
            "path must not contain encoded “.”, “/” or “\\”",
        ));
    }
    if decoded.contains("..") {
        return Err(DsError::failure("path must not contain “..”"));
    }
    if decoded.contains('\\') {
        return Err(DsError::failure("path must not contain “\\”"));
    }
    if decoded.starts_with('/') {
        return Err(DsError::failure("path must not start with “/”"));
    }
    Ok(())
}

fn layer_not_found(name: &str) -> String {
    format!("Could not find layer “{name}” in dataset.")
}

async fn layer(
    datasets: &DatasetCache,
    id: &str,
    name: &str,
) -> DsResult<std::sync::Arc<StaticLayer>> {
    let (_, layer) = datasets.get_with_layer(id, name).await.map_err(|e| {
        e.wrap(layer_not_found(name))
            .with_param_status(axum::http::StatusCode::NOT_FOUND)
    })?;
    Ok(layer)
}

async fn passthrough(
    path: VaultPath,
    headers: &HeaderMap,
    user_token: Option<&str>,
) -> DsResult<Response> {
    let range = ByteRange::from_range_header(
        headers
            .get(header::RANGE)
            .map(|v| v.to_str().unwrap_or_default()),
    )?;
    let read = path
        .read_bytes_encoding_and_range_header(range, user_token)
        .await?;
    let mut response = (
        range.success_status(),
        [(header::CONTENT_TYPE, "application/octet-stream")],
        read.bytes,
    )
        .into_response();
    let out = response.headers_mut();
    if let Some(encoding) = read.encoding.to_rfc7231() {
        out.insert(header::CONTENT_ENCODING, HeaderValue::from_static(encoding));
    }
    if let Some(range) = read
        .content_range
        .and_then(|r| HeaderValue::from_str(&r).ok())
    {
        out.insert(header::CONTENT_RANGE, range);
    }
    out.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    Ok(response)
}

async fn proxy_mag(
    State(access): State<AccessTokenService>,
    State(data_vaults): State<DataVaultService>,
    State(datasets): State<DatasetCache>,
    tc: TokenContext,
    Path((id, layer_name, mag, _)): Path<(String, String, String, String)>,
    uri: Uri,
    headers: HeaderMap,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    // ["", "data", "datasets", id, "proxy", "layers", layer, "mags", mag, *path]
    let path = raw_tail(&uri, 8);
    validate_path(&path)?;
    let mag_validated = Vec3Int::from_mag_literal(&mag, true)
        .ok_or_else(|| DsError::failure(format!("Invalid mag “{mag}”. Please use “x-y-z”.")))?;
    let layer = layer(&datasets, &id, &layer_name).await?;
    let locator = layer
        .mags
        .iter()
        .find(|m| m.mag == mag_validated)
        .ok_or_else(|| {
            DsError::failure(format!(
                "Data layer “{layer_name}” does not have mag “{mag}”."
            ))
            .with_param_status(axum::http::StatusCode::NOT_FOUND)
        })?;
    let mag_path = data_vaults.vault_path_for_mag(locator).await?;
    Ok(passthrough(mag_path.join(&path), &headers, tc.user_token.as_deref()).await?)
}

/// Neuroglancer readers request `info` at the parent of each mag; serve it with WEBKNOSSOS mag
/// literals as scale keys, dropping scales that are not a mag of this layer.
async fn proxy_precomputed_info(
    State(access): State<AccessTokenService>,
    State(data_vaults): State<DataVaultService>,
    State(datasets): State<DatasetCache>,
    tc: TokenContext,
    Path((id, layer_name)): Path<(String, String)>,
) -> AccessResult<Json<PrecomputedHeader>> {
    let id = dataset_id(&id)?;
    access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let layer = layer(&datasets, &id, &layer_name).await?;
    let first = layer.mags.first().ok_or_else(|| {
        DsError::failure(format!("Data layer “{layer_name}” has zero mags."))
            .with_param_status(axum::http::StatusCode::NOT_FOUND)
    })?;
    let mag_path = data_vaults.vault_path_for_mag(first).await?;
    let bytes = mag_path
        .parent()
        .join(FILENAME_INFO)
        .read_bytes(ByteRange::Complete, tc.user_token.as_deref())
        .await
        .map_err(DsError::from)?;
    let mut root =
        PrecomputedHeader::parse(&bytes).map_err(|e| e.wrap("Could not parse array header"))?;
    root.scales = std::mem::take(&mut root.scales)
        .into_iter()
        .filter_map(|mut scale| {
            let matching = layer
                .mags
                .iter()
                .find(|m| m.path.as_ref().is_some_and(|p| p.basename() == scale.key))?;
            scale.key = matching.mag.to_mag_literal(true);
            Some(scale)
        })
        .collect();
    Ok(Json(root))
}

async fn proxy_attachment(
    State(access): State<AccessTokenService>,
    State(data_vaults): State<DataVaultService>,
    State(datasets): State<DatasetCache>,
    tc: TokenContext,
    Path((id, layer_name, attachment_type, attachment_name, _)): Path<(
        String,
        String,
        String,
        String,
        String,
    )>,
    uri: Uri,
    headers: HeaderMap,
) -> AccessResult<Response> {
    let id = dataset_id(&id)?;
    access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    // ["", "data", "datasets", id, "proxy", "layers", layer, "attachments", type, name, *path]
    let path = raw_tail(&uri, 9);
    validate_path(&path)?;
    let layer = layer(&datasets, &id, &layer_name).await?;
    // Scala `fromString(..).toFox` without a message: `Empty`.
    let kind = LayerAttachmentType::from_name(&attachment_type).ok_or_else(DsError::empty)?;
    let attachment = layer
        .attachments
        .as_ref()
        .and_then(|a| a.get_by_type_and_name(kind, &attachment_name))
        .ok_or_else(|| {
            DsError::failure(format!(
                "Data layer “{layer_name}” does not have attachment “{attachment_name}”."
            ))
            .with_param_status(axum::http::StatusCode::NOT_FOUND)
        })?;
    let attachment_path = data_vaults.vault_path_for_attachment(attachment).await?;
    Ok(passthrough(
        attachment_path.join(&path),
        &headers,
        tc.user_token.as_deref(),
    )
    .await?)
}

pub(super) async fn proxy_datasource(
    State(access): State<AccessTokenService>,
    State(datasets): State<DatasetCache>,
    tc: TokenContext,
    Path(id): Path<String>,
) -> AccessResult<Json<UsableDataSource>> {
    let id = dataset_id(&id)?;
    access
        .validate_access(UserAccessRequest::read_dataset(&id), &tc)
        .await?;
    let source = datasets.get_by_id(&id).await.map_err(|e| {
        e.wrap(SOURCE_NOT_FOUND)
            .with_param_status(axum::http::StatusCode::NOT_FOUND)
    })?;
    Ok(Json(adapt_paths_for_data_source(&source)?))
}

/// Scala `adaptPathsForDataSource`: mags and attachments point at this controller's proxy routes.
pub fn adapt_paths_for_data_source(source: &UsableDataSource) -> DsResult<UsableDataSource> {
    let mut adapted = source.clone();
    for layer in &mut adapted.data_layers {
        let name = layer.name.clone();
        for mag in &mut layer.mags {
            mag.path = Some(UPath::parse(&format!(
                "./layers/{name}/mags/{}",
                mag.mag.to_mag_literal(true)
            ))?);
        }
        if let Some(attachments) = &layer.attachments {
            let failure = std::cell::RefCell::new(None);
            let mapped = attachments.mapped_with_type(|attachment, kind| {
                let mut attachment = attachment.clone();
                match UPath::parse(&format!(
                    "./layers/{name}/attachments/{kind}/{}",
                    attachment.name
                )) {
                    Ok(path) => attachment.path = path,
                    Err(e) => *failure.borrow_mut() = Some(e),
                }
                attachment
            });
            if let Some(e) = failure.into_inner() {
                return Err(e.into());
            }
            layer.attachments = Some(mapped);
        }
    }
    Ok(adapted)
}

#[cfg(test)]
mod controllers_data_proxy_tests;
