//! Dataset, organization and datastore lookups.
use axum::http::StatusCode;
use serde_json::Value;

use super::{
    failure::{Failure, RunError, RunResult},
    job_submission_dao::{self, Dataset, LayerRow},
};
use crate::{
    AppState, auth::AuthUser, error::ApiError, stores::client::ServiceClients, util::id::ObjectId,
};
use webknossos_common::{enums::LengthUnit, geometry::BoundingBox};

impl Dataset {
    /// The data source's voxel size (`dataset.voxelSize`) in nanometers
    /// (VoxelSize.toNanometer; a missing unit is nanometer).
    pub(crate) fn voxel_size_in_nanometers(&self) -> Option<[f64; 3]> {
        let factor = <[f64; 3]>::try_from(self.voxel_size_factor.clone()?).ok()?;
        let per_unit = self
            .voxel_size_unit
            .as_deref()
            .and_then(LengthUnit::from_name)
            .map_or(1.0, LengthUnit::to_nanometer);
        Some(factor.map(|component| component * per_unit))
    }
}

/// DatasetDAO.findOne with the user's access; `None` is the empty Fox (callers
/// attach their own message).
pub(crate) async fn find_readable_dataset(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> RunResult<Option<Dataset>> {
    Ok(job_submission_dao::find_one_readable_dataset(&state.pool, &user.id, id).await?)
}

/// DatasetDAO.findOne with the user's access `?~> Msg.Dataset.notFound(id) ~> NOT_FOUND`.
pub(super) async fn find_dataset(
    state: &AppState,
    user: &AuthUser,
    id: &ObjectId,
) -> RunResult<Dataset> {
    find_readable_dataset(state, user, id)
        .await?
        .ok_or_else(|| {
            Failure::with_status(crate::msg::dataset::not_found(id), StatusCode::NOT_FOUND).into()
        })
}

/// OrganizationDAO.findOne(dataset._organization) with global access.
pub(super) async fn find_organization(state: &AppState, organization: &str) -> RunResult<String> {
    job_submission_dao::find_organization_id(&state.pool, organization)
        .await?
        .ok_or_else(|| Failure::new(crate::msg::organization::not_found(organization)).into())
}

/// Dataset of the user's own organization, else 403 with the route's wrongOrga message.
pub(super) async fn own_organization(
    state: &AppState,
    user: &AuthUser,
    dataset: &Dataset,
    wrong_orga: &str,
) -> RunResult<String> {
    let organization = find_organization(state, &dataset.organization).await?;
    if user.organization_id != organization {
        return Err(Failure::with_status(wrong_orga, StatusCode::FORBIDDEN).into());
    }
    Ok(organization)
}

/// DatasetService.clientFor(dataset).getOrganizationBaseDirectory(user org, requireLocal = true).
pub(super) async fn organization_base_directory(
    state: &AppState,
    clients: &ServiceClients,
    user: &AuthUser,
    dataset: &Dataset,
) -> RunResult<String> {
    // DataStoreDAO.findOneByName with the user's access.
    let url = job_submission_dao::find_data_store_url_for_user(
        &state.pool,
        dataset.data_store.trim(),
        &user.id,
    )
    .await?
    .ok_or_else(|| Failure::new(crate::msg::data_store::NOT_FOUND))?;
    let directory: Value = clients
        .get_json(
            &url,
            &["data", "getOrganizationBaseDirectory"],
            &[
                ("organizationId", user.organization_id.clone()),
                ("requireLocal", "true".into()),
                ("requireAllowsUpload", "false".into()),
            ],
        )
        .await
        .map_err(ApiError::from)?;
    match directory {
        Value::String(directory) => Ok(directory),
        _ => Err(RunError::Api(ApiError::new(
            StatusCode::BAD_GATEWAY,
            crate::msg::request::SERVICE_INVALID_JSON,
        ))),
    }
}

pub(crate) struct DataLayer {
    pub(crate) name: String,
    pub(crate) bounding_box: BoundingBox,
    pub(crate) finest_mag: Option<[i32; 3]>,
}

/// DatasetService.getDataSourceAndLayerFor: the usable data source's bounding box
/// (union of all layers) and the requested layer.
pub(crate) async fn data_source_and_layer(
    state: &AppState,
    dataset: &Dataset,
    layer_name: &str,
) -> RunResult<(BoundingBox, DataLayer)> {
    let (data_source_box, layers) = usable_data_source(state, dataset).await?;
    let layer = layers
        .into_iter()
        .find(|layer| layer.name == layer_name)
        .ok_or_else(|| Failure::new(crate::msg::dataset::layer::not_found(layer_name)))?;
    Ok((data_source_box, layer))
}

/// DatasetService.usableDataSourceFor: the data source's bounding box (union of
/// all layers) and its layers, ordered by name.
pub(crate) async fn usable_data_source(
    state: &AppState,
    dataset: &Dataset,
) -> RunResult<(BoundingBox, Vec<DataLayer>)> {
    if !dataset.is_usable {
        return Err(Failure::new(crate::msg::dataset::not_usable(&dataset.id)).into());
    }
    if !dataset.has_voxel_size {
        return Err(
            Failure::new(crate::msg::dataset::data_source::USABLE_BUT_NO_VOXEL_SIZE)
                .wrap(crate::msg::dataset::data_source::NOT_FOUND)
                .with_param(StatusCode::NOT_FOUND)
                .into(),
        );
    }
    let rows: Vec<LayerRow> = job_submission_dao::find_all_layers(&state.pool, &dataset.id).await?;
    let mut layers = Vec::with_capacity(rows.len());
    for row in rows {
        let bounding_box = BoundingBox::from_sql(&row.bounding_box)
            .ok_or_else(|| RunError::Api(ApiError::internal()))?;
        let finest_mag = row
            .finest_mag
            .map(<[i32; 3]>::try_from)
            .transpose()
            .map_err(|_| RunError::Api(ApiError::internal()))?;
        layers.push(DataLayer {
            name: row.name,
            bounding_box,
            finest_mag,
        });
    }
    let data_source_box = layers
        .iter()
        .map(|layer| layer.bounding_box)
        .reduce(|a, b| a.union(&b))
        .unwrap_or_else(BoundingBox::empty);
    Ok((data_source_box, layers))
}

/// All mags of a data layer (DatasetMagDAO.findMagLocatorsForLayer: without pending
/// uploads and, as in Scala, without an ORDER BY).
pub(crate) async fn layer_mags(
    state: &AppState,
    dataset: &Dataset,
    layer_name: &str,
) -> RunResult<Vec<[i32; 3]>> {
    let rows =
        job_submission_dao::find_mags_for_layer(&state.pool, &dataset.id, layer_name).await?;
    Ok(rows.into_iter().map(|(x, y, z)| [x, y, z]).collect())
}
