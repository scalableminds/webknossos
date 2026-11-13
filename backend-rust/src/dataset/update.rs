//! PATCH /datasets/{id}/updatePartial with DatasetService.updateDataSourceFromUserChanges.
use std::collections::HashMap;

use axum::{Json, Router, extract::State, routing::patch};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use webknossos_common::{enums::LayerAttachmentType, upath::UPath};

mod dataset_update_dao;

use crate::{
    AppState,
    auth::AuthUser,
    dataset::source::{DataLayerAttachments, LayerKind, StaticLayer, UsableDataSource},
    error::{ApiError, ApiResult},
    extract::{Json as RequestJson, Path},
    state::JobsEnabled,
    stores::client::ServiceClients,
    util::id::{ObjectId, PathObjectId},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/datasets/{datasetId}/updatePartial", patch(update_partial))
}

/// TristateOptionJsonHelper: absent → None, null → Some(None).
fn tristate<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerRenaming {
    old_name: String,
    new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRenaming {
    /// The new layer name if the layer is renamed in the same request.
    layer_name: String,
    old_name: String,
    attachment_type: LayerAttachmentType,
    new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialUpdate {
    #[serde(default, deserialize_with = "tristate")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "tristate")]
    name: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::util::instant::optional")]
    sorting_key: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, deserialize_with = "nullable")]
    is_public: Option<bool>,
    #[serde(default, deserialize_with = "nullable")]
    tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    metadata: Option<Vec<Value>>,
    #[serde(default, deserialize_with = "nullable")]
    folder_id: Option<ObjectId>,
    #[serde(default, deserialize_with = "nullable")]
    data_source: Option<Value>,
    #[serde(default, deserialize_with = "nullable")]
    layer_renamings: Option<Vec<LayerRenaming>>,
    #[serde(default, deserialize_with = "nullable")]
    attachment_renamings: Option<Vec<AttachmentRenaming>>,
}

/// DatasetService.applyLayerUpdates: only category, bounding box, transforms,
/// view configurations and largestSegmentId are taken over; mags and
/// attachments can only be removed.
fn apply_layer_updates(existing: &StaticLayer, update: &StaticLayer) -> StaticLayer {
    let mut layer = existing.clone();
    layer.mags = existing
        .mags
        .iter()
        .filter(|m| update.mags.iter().any(|u| u.mag == m.mag))
        .cloned()
        .collect();
    layer.attachments = match (&existing.attachments, &update.attachments) {
        (Some(existing), Some(update)) => existing.drop_missing(update),
        _ => None,
    };
    layer.bounding_box = update.bounding_box;
    layer.coordinate_transformations = update.coordinate_transformations.clone();
    layer.default_view_configuration = update.default_view_configuration.clone();
    layer.admin_view_configuration = update.admin_view_configuration.clone();
    layer.kind = match (&existing.kind, &update.kind) {
        (LayerKind::Segmentation { mappings, .. }, LayerKind::Segmentation { .. }) => {
            LayerKind::Segmentation {
                largest_segment_id: update.largest_segment_id(),
                mappings: mappings.clone(),
            }
        }
        (LayerKind::Color, LayerKind::Segmentation { .. }) => LayerKind::Segmentation {
            largest_segment_id: update.largest_segment_id(),
            mappings: None,
        },
        (_, LayerKind::Color) => LayerKind::Color,
    };
    layer
}

/// DatasetService.applyDataSourceUpdates.
fn apply_updates(
    existing: &UsableDataSource,
    updates: &UsableDataSource,
    layer_renamings: &[LayerRenaming],
    attachment_renamings: &[AttachmentRenaming],
) -> Result<UsableDataSource, String> {
    let layer_names: HashMap<&str, &str> = layer_renamings
        .iter()
        .map(|r| (r.old_name.as_str(), r.new_name.as_str()))
        .collect();
    let mut renamed = existing.data_layers.clone();
    for layer in &mut renamed {
        if let Some(new_name) = layer_names.get(layer.name.as_str()) {
            layer.name = (*new_name).to_owned();
        }
    }
    for layer in &mut renamed {
        let attachment_names: HashMap<(LayerAttachmentType, String), String> = attachment_renamings
            .iter()
            .filter(|r| r.layer_name == layer.name)
            .map(|r| ((r.attachment_type, r.old_name.clone()), r.new_name.clone()))
            .collect();
        if let Some(attachments) = &mut layer.attachments {
            *attachments = attachments.rename_by_map(&attachment_names);
        }
    }
    let mut seen = std::collections::HashSet::new();
    if !renamed.iter().all(|l| seen.insert(l.name.clone())) {
        return Err("Layer renamings create name collisions.".into());
    }
    if renamed.iter().any(|l| {
        l.attachments
            .as_ref()
            .is_some_and(DataLayerAttachments::contains_duplicate_names)
    }) {
        return Err("Attachment renamings create name collisions.".into());
    }
    let mut layers: Vec<StaticLayer> = renamed
        .iter()
        .filter_map(|layer| {
            updates
                .data_layers
                .iter()
                .find(|u| u.name == layer.name)
                .map(|update| apply_layer_updates(layer, update))
        })
        .collect();
    let added: Vec<&StaticLayer> = updates
        .data_layers
        .iter()
        .filter(|u| !renamed.iter().any(|l| l.name == u.name))
        .collect();
    if added.iter().any(|l| !l.mags.is_empty()) {
        return Err(
            "New layers may not have mags. Add empty layers instead and then add mags.".into(),
        );
    }
    if added
        .iter()
        .any(|l| l.attachments.as_ref().is_some_and(|a| !a.is_empty()))
    {
        return Err("New layers may not have attachments. Add empty layers instead and then add attachments.".into());
    }
    layers.extend(added.into_iter().cloned());
    Ok(UsableDataSource {
        data_layers: layers,
        scale: updates.scale,
        ..existing.clone()
    })
}

/// UsableDataSource.allExplicitPaths as strings.
fn explicit_paths(source: &UsableDataSource) -> Vec<String> {
    source
        .all_explicit_paths()
        .into_iter()
        .map(ToString::to_string)
        .collect()
}

/// Seq.diff: multiset difference preserving order.
fn multiset_difference(left: &[String], right: &[String]) -> Vec<String> {
    let mut remaining: Vec<&String> = right.iter().collect();
    left.iter()
        .filter(|path| {
            if let Some(index) = remaining.iter().position(|r| r == path) {
                remaining.swap_remove(index);
                false
            } else {
                true
            }
        })
        .cloned()
        .collect()
}

async fn paths_used_only_by(pool: &sqlx::PgPool, dataset_id: &ObjectId) -> ApiResult<Vec<String>> {
    let raw = crate::dataset::dataset_dao::find_exclusive_paths(pool, dataset_id).await?;
    raw.iter()
        .map(|p| {
            UPath::parse(p)
                .map(|p| p.to_string())
                .map_err(|_| ApiError::internal())
        })
        .collect()
}

struct SourceChange {
    updated: UsableDataSource,
    paths_to_delete: Vec<String>,
}

async fn update_partial(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<PathObjectId>,
    State(JobsEnabled(jobs_enabled)): State<JobsEnabled>,
    State(clients): State<ServiceClients>,
    State(misc): State<crate::system::application_info::MiscState>,
    RequestJson(body): RequestJson<PartialUpdate>,
) -> ApiResult<Json<Value>> {
    let record = crate::dataset::lifecycle::require_editable(&state, &user, &id).await?;
    if let Some(metadata) = &body.metadata {
        crate::dataset::routes::validate_metadata(metadata)?;
    }
    let requested_source = body
        .data_source
        .as_ref()
        .map(|value| {
            UsableDataSource::from_json(value).map_err(crate::dataset::source::invalid_body)
        })
        .transpose()?;
    let mut change = None;
    if let Some(updates) = requested_source {
        if !record.is_usable {
            return Err(ApiError::bad_request(crate::msg::dataset::not_usable(&id)));
        }
        record.store_url()?;
        let existing = crate::dataset::source::load(&state.pool, &id).await?;
        let updated = apply_updates(
            &existing,
            &updates,
            body.layer_renamings.as_deref().unwrap_or_default(),
            body.attachment_renamings.as_deref().unwrap_or_default(),
        )
        .map_err(ApiError::bad_request)?;
        if updated != existing {
            let removed =
                multiset_difference(&explicit_paths(&existing), &explicit_paths(&updated));
            let only_this = if removed.is_empty() {
                Vec::new()
            } else {
                paths_used_only_by(&state.pool, &id).await?
            };
            change = Some(SourceChange {
                paths_to_delete: removed
                    .into_iter()
                    .filter(|p| only_this.contains(p))
                    .collect(),
                updated,
            });
        } else {
            tracing::info!(dataset = %id, "DataSource not updated as it is unchanged");
        }
    }

    let mut transaction = state.pool.begin().await?;
    crate::dataset::access::lock_edit(&mut transaction, &user, &id, true).await?;
    if let Some(folder) = &body.folder_id {
        // Same hardening as the full PATCH: keep the dataset in a live folder of its organization.
        crate::dataset::dataset_dao::lock_folder_in_organization(
            &mut transaction,
            folder,
            &record.organization,
        )
        .await?
        .ok_or_else(|| ApiError::bad_request(crate::msg::folder::NOT_IN_DATASET_ORGANIZATION))?;
    }
    dataset_update_dao::update_partial(&mut transaction, &id, &body).await?;
    if let Some(change) = &change {
        // DatasetDAO.updateDataSource with the user-changed source. The Scala
        // DAO also nulls defaultViewConfiguration here (the loaded source never
        // carries one); it is deliberately kept.
        crate::dataset::dataset_dao::delete_thumbnails(&mut transaction, &id).await?;
        dataset_update_dao::update_data_source(&mut transaction, &id, &change.updated).await?;
        crate::dataset::source::write_layers(&mut transaction, &id, &change.updated.data_layers)
            .await?;
    }
    let readable =
        crate::dataset::dataset_dao::is_readable_on_connection(&mut transaction, &user.id, &id)
            .await?;
    if !readable {
        return Err(crate::dataset::lifecycle::not_found(&id));
    }
    if let Some(change) = &change
        && !record.is_virtual
        && let Some(root) = &record.root_path
    {
        // Written to disk before the database change becomes visible; a
        // failure rolls the whole update back.
        crate::dataset::lifecycle::update_data_source_on_disk(
            &clients,
            &record,
            &json!(change.updated),
            root,
        )
        .await?;
    }
    transaction.commit().await?;

    if let Some(change) = &change {
        crate::dataset::lifecycle::invalidate_cache(&clients, &record).await?;
        crate::dataset::paths::delete_paths(
            &state.pool,
            &clients,
            record.store_url()?,
            &change.paths_to_delete,
        )
        .await?;
    }
    let updated = crate::dataset::lifecycle::load_record(&state.pool, &id)
        .await?
        .ok_or_else(|| crate::dataset::lifecycle::not_found(&id))?;
    crate::dataset::lifecycle::scan_realpaths_if_virtual(&state.pool, &clients, &updated).await?;
    crate::dataset::lifecycle::write_mirror_for_virtual(&state.pool, &clients, &updated).await?;
    // ChangeDatasetSettingsEvent (also LegacyApiController.updatePartialV12,
    // served by this handler on API v10-v12).
    crate::system::analytics::track(
        &state,
        &misc,
        &user,
        "change_dataset_settings".into(),
        crate::system::analytics::properties("dataset_id", id.as_str()),
    );
    Ok(Json(
        crate::dataset::routes::full_json(&state.pool, Some(&user), &id, jobs_enabled).await?,
    ))
}

#[cfg(test)]
mod dataset_update_tests;
