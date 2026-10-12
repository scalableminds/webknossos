//! DSLegacyApiController overrides from datastore.versioned.routes, preserving old DTOs.
use super::{
    data_proxy,
    helpers::{dataset_id, validated_body},
    upload, zarr_streaming,
};
use crate::{
    AppState,
    access::{AccessResult, TokenContext, UserAccessRequest},
    controller,
    error::DsError,
    models::{
        JsResult,
        datasource::patch_largest_segment_id,
        json::{Fields, PlayValue, read_bool, read_i64, read_list, read_string},
    },
};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{DefaultBodyLimit, Multipart, Path, RawQuery, State, rejection::JsonRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};

pub fn router(json_limit: usize) -> Router<AppState> {
    let mut reads = Router::new();
    let mut json_uploads = Router::new();
    let mut chunks = Router::new().route("/data/datasets", get(test_chunk).post(upload_chunk));
    for version in 10..=14 {
        reads = reads.route(
            &format!("/data/v{version}/datasets/{{datasetId}}/proxy/datasource-properties.json"),
            get(proxy_source),
        );
        for (name, v3) in [
            ("zarr", false),
            ("zarr3", true),
            ("zarr3_experimental", true),
        ] {
            let path = format!("/data/v{version}/{name}/{{datasetId}}/datasource-properties.json");
            let private = format!(
                "/data/v{version}/annotations/{name}/{{accessTokenOrId}}/datasource-properties.json"
            );
            if v3 {
                reads = reads
                    .route(&path, get(zarr_source::<3>))
                    .route(&private, get(private_source::<3>));
            } else {
                reads = reads
                    .route(&path, get(zarr_source::<2>))
                    .route(&private, get(private_source::<2>));
            }
        }
        if version <= 13 {
            chunks = chunks.route(
                &format!("/data/v{version}/datasets"),
                get(test_chunk).post(upload_chunk),
            );
            reads = reads.route(
                &format!("/data/v{version}/datasets/unfinishedUploads"),
                get(unfinished),
            );
            json_uploads = json_uploads.route(
                &format!("/data/v{version}/datasets/finishUpload"),
                post(finish),
            );
            json_uploads = if version <= 11 {
                json_uploads.route(
                    &format!("/data/v{version}/datasets/reserveUpload"),
                    post(reserve::<true>),
                )
            } else {
                json_uploads.route(
                    &format!("/data/v{version}/datasets/reserveUpload"),
                    post(reserve::<false>),
                )
            };
        }
    }
    json_uploads = json_uploads.route(
        "/data/v10/datasets/reserveManualUpload",
        post(reserve_manual),
    );
    controller(
        reads
            .merge(chunks)
            .merge(json_uploads.layer(DefaultBodyLimit::max(json_limit))),
        true,
    )
}

async fn downgrade(mut response: Response) -> Response {
    if response.status() != StatusCode::OK {
        return response;
    }
    let body = std::mem::replace(response.body_mut(), axum::body::Body::empty());
    match to_bytes(body, usize::MAX).await {
        Ok(bytes) => {
            *response.body_mut() = match serde_json::from_slice::<Value>(&bytes) {
                Ok(value) => axum::body::Body::from(
                    serde_json::to_vec(&PlayValue(&patch_largest_segment_id(value)))
                        .expect("JSON serializes"),
                ),
                Err(_) => axum::body::Body::from(bytes),
            };
            response.headers_mut().remove(header::CONTENT_LENGTH);
            response
        }
        Err(error) => DsError::from_exception(error).into_response(),
    }
}
async fn proxy_source(state: State<AppState>, tc: TokenContext, id: Path<String>) -> Response {
    downgrade(
        data_proxy::proxy_datasource(state, tc, id)
            .await
            .into_response(),
    )
    .await
}
async fn zarr_source<const V: u8>(
    state: State<AppState>,
    tc: TokenContext,
    id: Path<String>,
) -> Response {
    let binder_ok = dataset_id(&id.0).is_ok();
    let mut response = zarr_streaming::data_source::<V>(state, tc, id)
        .await
        .into_response();
    if binder_ok && response.status() == StatusCode::BAD_REQUEST {
        *response.status_mut() = StatusCode::NOT_FOUND;
    }
    downgrade(response).await
}
async fn private_source<const V: u8>(
    state: State<AppState>,
    tc: TokenContext,
    id: Path<String>,
) -> Response {
    let mut response = zarr_streaming::private_data_source::<V>(state, tc, id)
        .await
        .into_response();
    if response.status() == StatusCode::BAD_REQUEST {
        *response.status_mut() = StatusCode::NOT_FOUND;
    }
    downgrade(response).await
}
async fn test_chunk(
    state: State<AppState>,
    tc: TokenContext,
    query: RawQuery,
) -> AccessResult<StatusCode> {
    upload::test_chunk(state, tc, Path("dataset".into()), query).await
}
async fn upload_chunk(
    state: State<AppState>,
    tc: TokenContext,
    multipart: Multipart,
) -> AccessResult<Response> {
    upload::upload_chunk(state, tc, Path("dataset".into()), multipart).await
}
async fn unfinished(
    state: State<AppState>,
    tc: TokenContext,
    query: RawQuery,
) -> AccessResult<Json<Vec<Value>>> {
    upload::unfinished_uploads(state, tc, Path("dataset".into()), query).await
}
fn legacy_finish(value: &Value) -> JsResult<String> {
    let mut fields = Fields::new(value);
    let id = fields.req("uploadId", read_string);
    let _conversion = fields.opt("needsConversion", read_bool);
    fields.finish()?;
    id
}
async fn finish(
    state: State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let upload_id = match validated_body(body, legacy_finish) {
        Ok(id) => id,
        Err(response) => return Ok(*response),
    };
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("uploadId", &upload_id)
        .finish();
    let Json(mut body) =
        upload::finish_upload(state, tc, Path("dataset".into()), RawQuery(Some(query))).await?;
    if let Some(map) = body.as_object_mut()
        && let Some(id) = map.remove("datasetId")
    {
        map.insert("newDatasetId".into(), id);
    }
    Ok(Json(body).into_response())
}
fn legacy_layer(value: &Value) -> JsResult<Value> {
    let mut fields = Fields::new(value);
    let organization_id = fields.opt("organizationId", read_string);
    let organization_name = fields.opt("organizationName", read_string);
    let _directory = fields.opt("datasetDirectoryName", read_string);
    let name = fields.req("dataSetName", read_string);
    let layer = fields.req("layerName", read_string);
    let new = fields.opt("newLayerName", read_string);
    fields.finish()?;
    let mut value = json!({"organization":organization_id?.or(organization_name?).unwrap_or_default(), "dataSetName":name?, "layerName":layer?});
    if let Some(name) = new? {
        value["newLayerName"] = Value::String(name);
    }
    Ok(value)
}
fn legacy_reserve<const OLD: bool>(value: &Value) -> JsResult<Value> {
    let mut f = Fields::new(value);
    let id = f.req("uploadId", read_string);
    let name = f.req("name", read_string);
    let org = f.req("organization", read_string);
    let count = f.req("totalFileCount", read_i64);
    let paths = f.opt("filePaths", |v| read_list(v, read_string));
    let size = f.opt("totalFileSizeInBytes", read_i64);
    let links = f.opt("layersToLink", |v| {
        read_list(
            v,
            if OLD {
                legacy_layer
            } else {
                upload::read_linked_layer
            },
        )
    });
    let teams = f.req("initialTeams", |v| read_list(v, upload::read_object_id));
    let folder = f.opt("folderId", upload::read_object_id);
    let unique = f.opt("requireUniqueName", read_bool);
    let virtual_ = f.opt("isVirtual", read_bool);
    let _conversion = f.opt("needsConversion", read_bool); // Scala explicitly discards this field.
    f.finish()?;
    let mut info = json!({"resumableUploadInfo":{"uploadId":id?,"totalFileCount":count?}, "datasetName":name?, "organizationId":org?, "initialTeamIds":teams?});
    if let Some(paths) = paths? {
        info["resumableUploadInfo"]["filePaths"] = json!(paths);
    }
    if let Some(size) = size? {
        info["resumableUploadInfo"]["totalFileSizeInBytes"] = json!(size);
    }
    for (key, value) in [
        ("layersToLink", links?.map(|v| json!(v))),
        ("folderId", folder?.map(Value::String)),
        ("requireUniqueName", unique?.map(Value::Bool)),
        ("isVirtual", virtual_?.map(Value::Bool)),
    ] {
        if let Some(value) = value {
            info[key] = value;
        }
    }
    Ok(info)
}
async fn reserve<const OLD: bool>(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let mut adapted = match validated_body(body, legacy_reserve::<OLD>) {
        Ok(body) => body,
        Err(response) => return Ok(*response),
    };
    if OLD {
        if adapted.get("layersToLink").is_none() {
            adapted["layersToLink"] = json!([]);
        }
        state
            .access
            .validate_access(
                UserAccessRequest::administrate_datasets_of(
                    adapted["organizationId"]
                        .as_str()
                        .expect("validated organization"),
                ),
                &tc,
            )
            .await?;
        if let Some(links) = adapted
            .get_mut("layersToLink")
            .and_then(Value::as_array_mut)
        {
            for link in links {
                let name = link["dataSetName"]
                    .as_str()
                    .expect("validated dataset name");
                let id = if name.len() == 24 && name.bytes().all(|c| c.is_ascii_hexdigit()) {
                    name.to_ascii_lowercase()
                } else {
                    state
                        .wk_client
                        .get_dataset_id(
                            link["organization"]
                                .as_str()
                                .expect("validated organization"),
                            name,
                        )
                        .await?
                };
                let mut new = json!({"datasetId":id, "layerName":link["layerName"]});
                if let Some(name) = link.get("newLayerName") {
                    new["newLayerName"] = name.clone();
                }
                *link = new;
            }
        }
    }
    upload::reserve_dataset_upload(State(state), tc, Ok(Json(adapted))).await
}
fn manual_info(value: &Value) -> JsResult<Value> {
    let mut f = Fields::new(value);
    let name = f.req("datasetName", read_string);
    let org = f.req("organization", read_string);
    let teams = f.req("initialTeamIds", |v| read_list(v, upload::read_object_id));
    let folder = f.opt("folderId", upload::read_object_id);
    let unique = f.with_default("requireUniqueName", false, read_bool);
    f.finish()?;
    let mut info = json!({"datasetName":name?, "organizationId":org?, "initialTeamIds":teams?, "resumableUploadInfo":{"uploadId":"aManualUpload","totalFileCount":0,"filePaths":[]}, "requireUniqueName":unique?, "isVirtual":false});
    if let Some(folder) = folder? {
        info["folderId"] = Value::String(folder);
    }
    Ok(info)
}
async fn reserve_manual(
    State(state): State<AppState>,
    tc: TokenContext,
    body: Result<Json<Value>, JsonRejection>,
) -> AccessResult<Response> {
    let info = match validated_body(body, manual_info) {
        Ok(body) => body,
        Err(response) => return Ok(*response),
    };
    state
        .access
        .validate_access(
            UserAccessRequest::administrate_datasets_of(
                info["organizationId"]
                    .as_str()
                    .expect("validated organization"),
            ),
            &tc,
        )
        .await?;
    let reserved: Value = state
        .wk_client
        .reserve_dataset_upload(&info, &tc)
        .await
        .map_err(|e| e.wrap("Could not validate dataset information for upload."))?;
    let id = reserved
        .get("newDatasetId")
        .and_then(Value::as_str)
        .ok_or_else(|| DsError::failure("Invalid reserveDatasetUpload answer"))?;
    let directory = reserved
        .get("directoryName")
        .and_then(Value::as_str)
        .ok_or_else(|| DsError::failure("Invalid reserveDatasetUpload answer"))?;
    Ok(Json(json!({"newDatasetId":id,"directoryName":directory})).into_response())
}
