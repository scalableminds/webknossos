//! TaskTypeDAO: the task type queries.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::{TaskTypeParameters, TracingMode};
use crate::{
    auth::AuthUser,
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

pub(crate) const PUBLIC_TASK_TYPE: &str = r#"SELECT jsonb_build_object(
 'id',tt._id,'summary',tt.summary,'description',tt.description,'teamId',tt._team,
 'teamName',team.name,'settings',jsonb_strip_nulls(jsonb_build_object(
    'allowedModes',tt.settings_allowedmodes,'preferredMode',tt.settings_preferredmode,
    'branchPointsAllowed',tt.settings_branchpointsallowed,'somaClickingAllowed',tt.settings_somaclickingallowed,
    'volumeInterpolationAllowed',tt.settings_volumeinterpolationallowed,'mergerMode',tt.settings_mergermode,
    'magRestrictions',jsonb_build_object('min',tt.settings_magrestrictions_min,'max',tt.settings_magrestrictions_max))),
 'recommendedConfiguration',tt.recommendedconfiguration,'tracingType',tt.tracingtype
) FROM webknossos.tasktypes_ tt JOIN webknossos.teams_ team ON team._id=tt._team "#;

/// TaskTypeDAO.readAccessQ for alias `tt`.
fn push_read_access<'a>(q: &mut Sql<'a>, requester: Requester<'a>) {
    q.push("(tt._organization=")
        .push_arg(requester.organization)
        .push(" AND (")
        .push_bind(requester.is_admin)
        .push(" OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=")
        .push_arg(requester.id)
        .push(" AND _team=tt._team)))");
}

/// The public JSON of one task type the user may read.
pub(crate) async fn find_one_json<'e, E: sqlx::Executor<'e, Database = sqlx::Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &ObjectId,
) -> sqlx::Result<Option<Value>> {
    let mut q = Sql::new(PUBLIC_TASK_TYPE);
    q.push(" WHERE ");
    push_read_access(&mut q, user.into());
    q.push(" AND tt._id=").push_bind(id);
    q.build_query_scalar().fetch_optional(executor).await
}

/// The public JSON of every task type the user may read.
pub(crate) async fn find_all_json(pool: &PgPool, user: &AuthUser) -> sqlx::Result<Vec<Value>> {
    let mut q = Sql::new(PUBLIC_TASK_TYPE);
    q.push(" WHERE ");
    push_read_access(&mut q, user.into());
    q.build_query_scalar().fetch_all(pool).await
}

/// Takes a transaction-scoped advisory lock on the organization/summary.
pub(crate) async fn lock_summary(
    connection: &mut PgConnection,
    organization_id: &str,
    summary: &str,
) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("taskType:{}:{}", organization_id, summary))
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn is_summary_taken(
    connection: &mut PgConnection,
    organization_id: &str,
    summary: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ WHERE _organization=$1 AND summary=$2)",
    )
    .bind(organization_id)
    .bind(summary)
    .fetch_one(connection)
    .await
}

/// Whether another task type (not `id`) of the organization has the summary.
pub(crate) async fn is_summary_taken_by_other(
    connection: &mut PgConnection,
    organization_id: &str,
    summary: &str,
    id: &ObjectId,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ WHERE _organization=$1 AND summary=$2 AND _id<>$3)")
        .bind(organization_id).bind(summary).bind(id).fetch_one(connection).await
}

pub(crate) async fn insert_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization_id: &str,
    parameters: &TaskTypeParameters,
) -> sqlx::Result<()> {
    let modes: Vec<&str> = parameters
        .settings
        .allowed_modes
        .iter()
        .map(TracingMode::as_str)
        .collect();
    sqlx::query(
        "INSERT INTO \
            webknossos.tasktypes(_id,_organization,_team,summary,description,\
            settings_allowedmodes,settings_preferredmode,settings_branchpointsallowed,\
            settings_somaclickingallowed,settings_volumeinterpolationallowed,\
            settings_mergermode,settings_magrestrictions_min,settings_magrestrictions_max,\
            recommendedconfiguration,tracingtype) VALUES($1,$2,$3,$4,$5,\
            $6::text[]::webknossos.tasktype_modes[],$7::text::webknossos.tasktype_modes,$8,$9,\
            $10,$11,$12,$13,$14,$15::text::webknossos.tasktype_tracingtypes)",
    )
    .bind(id)
    .bind(organization_id)
    .bind(&parameters.team_id)
    .bind(&parameters.summary)
    .bind(&parameters.description)
    .bind(modes)
    .bind(
        parameters
            .settings
            .preferred_mode
            .as_ref()
            .map(TracingMode::as_str),
    )
    .bind(parameters.settings.branch_points_allowed)
    .bind(parameters.settings.soma_clicking_allowed)
    .bind(parameters.settings.volume_interpolation_allowed)
    .bind(parameters.settings.merger_mode)
    .bind(parameters.settings.mag_restrictions.min)
    .bind(parameters.settings.mag_restrictions.max)
    .bind(&parameters.recommended_configuration)
    .bind(parameters.tracing_type.as_str())
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn update_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    parameters: &TaskTypeParameters,
) -> sqlx::Result<()> {
    let modes: Vec<&str> = parameters
        .settings
        .allowed_modes
        .iter()
        .map(TracingMode::as_str)
        .collect();
    sqlx::query(
        "UPDATE webknossos.tasktypes SET \
            _team=$2,summary=$3,description=$4,\
            settings_allowedmodes=$5::text[]::webknossos.tasktype_modes[],\
            settings_preferredmode=$6::text::webknossos.tasktype_modes,\
            settings_branchpointsallowed=$7,settings_somaclickingallowed=$8,\
            settings_volumeinterpolationallowed=$9,settings_mergermode=$10,\
            recommendedconfiguration=$11 WHERE _id=$1 AND NOT isdeleted",
    )
    .bind(id)
    .bind(&parameters.team_id)
    .bind(&parameters.summary)
    .bind(&parameters.description)
    .bind(modes)
    .bind(
        parameters
            .settings
            .preferred_mode
            .as_ref()
            .map(TracingMode::as_str),
    )
    .bind(parameters.settings.branch_points_allowed)
    .bind(parameters.settings.soma_clicking_allowed)
    .bind(parameters.settings.volume_interpolation_allowed)
    .bind(parameters.settings.merger_mode)
    .bind(&parameters.recommended_configuration)
    .execute(connection)
    .await?;
    Ok(())
}

/// Soft-deletes the task type and suffixes its summary.
pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> sqlx::Result<()> {
    sqlx::query("UPDATE webknossos.tasktypes SET isdeleted=true,summary=summary || '.deleted.at.' || floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text WHERE _id=$1 AND NOT isdeleted")
        .bind(id).execute(connection).await?;
    Ok(())
}

/// Locks the live task type of the organization (FOR UPDATE) and returns its team.
pub(crate) async fn lock_one(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
) -> sqlx::Result<Option<ObjectId>> {
    sqlx::query_scalar(
        "SELECT _team FROM webknossos.tasktypes WHERE _id=$1 AND _organization=$2 AND NOT \
            isdeleted FOR UPDATE",
    )
    .bind(id)
    .bind(organization)
    .fetch_optional(connection)
    .await
}
