//! Database rows and user lookups.

use sqlx::PgPool;

use crate::{annotation::nml::writer::NmlVoxelSize, error::ApiResult, util::id::ObjectId};

use super::annotation_download_dao;

#[derive(Debug, Clone, sqlx::FromRow)]
pub(super) struct LayerRow {
    pub(super) tracing_id: String,
    pub(super) typ: String,
    pub(super) name: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub(super) struct DatasetRow {
    pub(super) id: ObjectId,
    pub(super) name: String,
    pub(super) organization: String,
    factor: Option<Vec<f64>>,
    unit: Option<String>,
}

impl DatasetRow {
    /// Dataset.voxelSize (unit defaults to nanometer).
    pub(super) fn voxel_size(&self) -> Option<NmlVoxelSize> {
        let factor = self.factor.as_ref()?;
        Some(NmlVoxelSize {
            factor: [
                factor.first().copied()?,
                factor.get(1).copied()?,
                factor.get(2).copied()?,
            ],
            unit: self.unit.clone().unwrap_or_else(|| "nanometer".into()),
        })
    }
}

/// UserService.findOneCached under GlobalAccessContext: the owner's MultiUser id.
pub(super) async fn find_user_multi_user(
    pool: &PgPool,
    user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(crate::annotation::annotation_dao::find_multi_user_id(pool, user_id).await?)
}

/// MultiUserDAO.findOne: (firstName, lastName), `None` when unreadable.
pub(super) async fn find_multi_user(
    pool: &PgPool,
    multi_user_id: &ObjectId,
    readable: bool,
) -> ApiResult<Option<(String, String)>> {
    if !readable {
        return Ok(None);
    }
    Ok(annotation_download_dao::find_multi_user_names(pool, multi_user_id).await?)
}
