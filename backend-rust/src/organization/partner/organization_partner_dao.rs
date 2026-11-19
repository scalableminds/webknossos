//! PartnerDAO: the partner queries. The partner JSON of an organization is part of
//! `organization_dao`'s public JSON.
use sqlx::PgExecutor;

use crate::util::id::ObjectId;

/// PartnerDAO.findOne (GlobalAccessContext): whether a live partner with the id exists.
pub(crate) async fn exists(executor: impl PgExecutor<'_>, id: &ObjectId) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.partners_ WHERE _id = $1)")
        .bind(id)
        .fetch_one(executor)
        .await
}
