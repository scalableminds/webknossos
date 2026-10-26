//! Annotation list and serialization queries: the list grants and filters, the
//! page and count of the annotation lists and the rows `publicWrites` renders.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::Filters;
use crate::{
    auth::AuthUser,
    error::ApiResult,
    sql::{PushArg, Requester, Sql},
    util::id::ObjectId,
};

// The optional filters are spelled into the statement text instead of `($n IS NULL OR ...)`:
// each combination is its own cached prepared statement, and its generic plan then estimates
// rows correctly (the catch-all form led to a 14x slower nested-loop plan for the list page).
pub(crate) fn state_filter(is_finished: Option<bool>) -> &'static str {
    match is_finished {
        None => "a.state<>'Cancelled'",
        Some(true) => "a.state='Finished'",
        Some(false) => "a.state='Active'",
    }
}
/// State, owner and dataset filters.
fn push_optional_filters<'a>(q: &mut Sql<'a>, owner: Option<&'a ObjectId>, filters: &'a Filters) {
    q.push(" AND ").push(state_filter(filters.is_finished));
    if let Some(owner) = owner {
        q.push(" AND a._user=").push_bind(owner);
    }
    if let Some(dataset_id) = &filters.dataset_id {
        q.push(" AND a._dataset=").push_bind(dataset_id);
    }
}
const LAYERS: &str = "SELECT jsonb_agg(jsonb_build_object('tracingId',layer.tracingId,'typ',layer.typ,'name',layer.name,'stats',layer.statistics) ORDER BY layer.tracingId) FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id";
const COMPACT_USER: &str = r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
    'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'isTeamManager',role.isTeamManager) ORDER BY team._id)
      FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=u._id AND team._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser WHERE u._id=$1"#;
/// Annotation list access (AnnotationDAO.listAccessQ when `shared`).
pub(crate) fn push_list_grant<'a>(q: &mut Sql<'a>, requester: Requester<'a>, shared: bool) {
    if !shared {
        return crate::annotation::access::push_read_predicate(q, requester);
    }
    q.push("(a._user=").push_arg(requester.id).push(" OR (");
    crate::annotation::access::push_owned_or_shared_predicate(q, requester);
    q.push(" AND EXISTS(SELECT 1 FROM webknossos.datasets_ d WHERE d._id=a._dataset AND ");
    crate::dataset::access::push_read_predicate(q, requester.id, None);
    q.push(")))");
}
/// The number of annotations of type `typ` the user may list.
pub(crate) async fn count(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: Option<&ObjectId>,
    typ: &str,
    filters: &Filters,
    shared: bool,
) -> ApiResult<i64> {
    let mut q = Sql::new("SELECT count(*) FROM webknossos.annotations_ a WHERE ");
    push_list_grant(&mut q, user.into(), shared);
    push_optional_filters(&mut q, owner, filters);
    q.push(" AND a.typ::text=").push_bind(typ);
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

/// One page of the compact annotation JSON.
pub(crate) async fn find_all_compact(
    connection: &mut PgConnection,
    user: &AuthUser,
    owner: Option<&ObjectId>,
    filters: &Filters,
    shared: bool,
    limit: i64,
    offset: i64,
) -> ApiResult<Vec<Value>> {
    // Two steps: select the page of ids over narrow rows first, then build the JSON (layers,
    // tags, shared teams) only for that page instead of for every row up to the offset.
    let mut q = Sql::new(
        r#"WITH page AS MATERIALIZED (SELECT a._id
        FROM webknossos.annotations_ a JOIN webknossos.users_ u ON u._id=a._user JOIN webknossos.multiUsers_ m ON m._id=u._multiUser
        JOIN webknossos.datasets_ d ON d._id=a._dataset JOIN webknossos.organizations_ organization ON organization._id=d._organization
        WHERE a.typ='Explorational' AND "#,
    );
    push_list_grant(&mut q, user.into(), shared);
    push_optional_filters(&mut q, owner, filters);
    q.push(
        r#"
        AND EXISTS(SELECT 1 FROM webknossos.annotation_layers layer WHERE layer._annotation=a._id)
        ORDER BY a._id DESC LIMIT "#,
    )
    .push_bind(limit)
    .push(" OFFSET ")
    .push_bind(offset)
    .push(
        r#")
        SELECT jsonb_build_object('modified',floor(extract(epoch FROM a.modified)*1000)::bigint,'created',floor(extract(epoch FROM a.created)*1000)::bigint,
        'state',a.state,'id',a._id,'name',a.name,'description',a.description,'typ',a.typ,'stats','{}'::jsonb,
        'isLockedByOwner',a.isLockedByOwner,'annotationLayers',("#,
    )
    .push(LAYERS)
    .push(
        r#"),'dataSetName',d.name,'datasetId',d._id,'organization',organization._id,
        'visibility',a.visibility,'tracingTime',COALESCE(a.tracingTime,0),'collaborationMode',a.collaborationMode,
        -- annotation.tags ++ Set(dataset.name): Scala's small immutable sets keep insertion order.
        'tags',ARRAY(SELECT tag FROM (SELECT DISTINCT ON (tag) tag,ord FROM unnest(a.tags||ARRAY[d.name]) WITH ORDINALITY t(tag,ord) ORDER BY tag,ord) first ORDER BY ord),
        'owner',jsonb_build_object('id',u._id,'firstName',m.firstName,'lastName',m.lastName),
        'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'organizationId',team._organization) ORDER BY team._id)
            FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team
            JOIN webknossos.organizations_ team_org ON team_org._id=team._organization WHERE shared._annotation=a._id),'[]'::jsonb))
        FROM page JOIN webknossos.annotations_ a ON a._id=page._id JOIN webknossos.users_ u ON u._id=a._user
        JOIN webknossos.multiUsers_ m ON m._id=u._multiUser JOIN webknossos.datasets_ d ON d._id=a._dataset
        JOIN webknossos.organizations_ organization ON organization._id=d._organization
        ORDER BY a._id DESC"#,
    );
    // Run inside `GENERIC_PLANS` (see there).
    Ok(q.build_query_scalar().fetch_all(connection).await?)
}

pub(crate) async fn update_last_activity(pool: &PgPool, user_id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.users SET lastActivity=now() WHERE _id=$1 AND NOT isDeleted")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Whether the user manages the target user (or is admin of its organization)
/// and whether the target belongs to no team of its organization; `None` unless
/// the target is the user itself, in the user's organization and visible to it.
pub(crate) async fn find_user_access(
    pool: &PgPool,
    user: &AuthUser,
    id: &ObjectId,
) -> ApiResult<Option<(bool, bool)>> {
    Ok(sqlx::query_as(
        r#"SELECT ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles target_role
        JOIN webknossos.teams_ team ON team._id=target_role._team AND team._organization=$2
        JOIN webknossos.user_team_roles requester_role ON requester_role._team=team._id AND requester_role._user=$1 AND requester_role.isTeamManager
        WHERE target_role._user=target._id)) AS manager,
        NOT EXISTS(SELECT 1 FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=target._id AND team._organization=target._organization) AS unteamed
        FROM webknossos.users_ target WHERE target._id=$4 AND target._organization=$2 AND (target._id=$1 OR $3 OR EXISTS(
          SELECT 1 FROM webknossos.user_team_roles target_role JOIN webknossos.teams_ team ON team._id=target_role._team AND team._organization=$2
          JOIN webknossos.user_team_roles requester_role ON requester_role._team=team._id AND requester_role._user=$1 AND requester_role.isTeamManager WHERE target_role._user=target._id))"#,
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// One page of the ids of the owner's Task annotations the user may read.
pub(crate) async fn find_all_task_annotation_ids(
    pool: &PgPool,
    user: &AuthUser,
    owner: &ObjectId,
    filters: &Filters,
    limit: i64,
    offset: i64,
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new("SELECT a._id FROM webknossos.annotations_ a WHERE ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    q.push(" AND a._user=")
        .push_bind(owner)
        .push(" AND ")
        .push(state_filter(filters.is_finished))
        .push(" AND a.typ='Task' ORDER BY a._id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// The team of the task's project, if the task is live and the user belongs to
/// that team or is an admin of its organization.
pub(crate) async fn find_task_team(
    pool: &PgPool,
    user: &AuthUser,
    task_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT p._team FROM webknossos.tasks_ task JOIN webknossos.projects_ p ON \
            p._id=task._project JOIN webknossos.teams_ team ON team._id=p._team AND \
            team._organization=$2 WHERE task._id=$4 AND p._organization=$2 AND ($3 OR \
            EXISTS(SELECT 1 FROM webknossos.user_team_roles role WHERE role._team=p._team AND \
            role._user=$1))",
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(task_id)
    .fetch_optional(pool)
    .await?)
}

/// The ids of the task's non-cancelled annotations the user may read.
pub(crate) async fn find_all_annotation_ids_for_task(
    pool: &PgPool,
    user: &AuthUser,
    task_id: &ObjectId,
) -> ApiResult<Vec<ObjectId>> {
    let mut q = Sql::new("SELECT a._id FROM webknossos.annotations_ a WHERE a._task=");
    q.push_bind(task_id)
        .push(" AND a.typ='Task' AND a.state<>'Cancelled' AND ");
    crate::annotation::access::push_read_predicate(&mut q, user.into());
    Ok(q.build_query_scalar().fetch_all(pool).await?)
}

/// The annotation as `publicWrites` renders it, without owner, contributors,
/// restrictions, datastore, task and settings; `viewer` selects the view configuration.
pub(crate) async fn find_full_json(
    connection: &mut PgConnection,
    viewer: Option<&ObjectId>,
    id: &ObjectId,
) -> ApiResult<Option<Value>> {
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object('modified',floor(extract(epoch FROM a.modified)*1000)::bigint,'created',floor(extract(epoch FROM a.created)*1000)::bigint,
        'state',a.state,'isLockedByOwner',a.isLockedByOwner,'id',a._id,'name',a.name,'description',a.description,
        'viewConfiguration',CASE WHEN "#,
    );
    q.push_bind(viewer)
        .push(
            "::text IS NULL THEN NULL ELSE (SELECT viewConfiguration FROM webknossos.user_annotationViewConfigurations config WHERE config._annotation=a._id AND config._user IN (",
        )
        .push_bind(viewer)
        .push(",a._user) ORDER BY (config._user=")
        .push_bind(viewer)
        .push(
            r#") DESC LIMIT 1) END,
        'typ',a.typ,'stats','{}'::jsonb,'annotationLayers',COALESCE(("#,
        )
        .push(LAYERS)
        .push(
            r#"),'[]'::jsonb),'datasetId',d._id,'dataSetName',d.name,'organization',organization._id,
        'visibility',a.visibility,'tracingTime',a.tracingTime,'collaborationMode',a.collaborationMode,
        'tags',ARRAY(SELECT tag FROM (SELECT DISTINCT ON (tag) tag,ord FROM unnest(a.tags||ARRAY[d.name]) WITH ORDINALITY t(tag,ord) ORDER BY tag,ord) first ORDER BY ord),
        'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'organization',team._organization,'isOrganizationTeam',team.isOrganizationTeam) ORDER BY team._id)
          FROM webknossos.annotation_sharedTeams shared JOIN webknossos.teams_ team ON team._id=shared._team JOIN webknossos.organizations_ team_org ON team_org._id=team._organization WHERE shared._annotation=a._id),'[]'::jsonb),
        'tracingStore',(SELECT jsonb_build_object('name',store.name,'url',store.publicUrl) FROM webknossos.tracingStores_ store LIMIT 1))
        FROM webknossos.annotations_ a JOIN webknossos.datasets_ d ON d._id=a._dataset JOIN webknossos.organizations_ organization ON organization._id=d._organization WHERE a._id="#,
        )
        .push_bind(id);
    Ok(q.build_query_scalar().fetch_optional(connection).await?)
}

/// The ids of the annotation's listed contributors.
pub(crate) async fn find_contributor_ids(
    connection: &mut PgConnection,
    annotation_id: &ObjectId,
) -> ApiResult<Vec<ObjectId>> {
    Ok(sqlx::query_scalar(
        "SELECT u._id FROM webknossos.annotation_contributors contributor JOIN \
            webknossos.users_ u ON u._id=contributor._user WHERE contributor._annotation=$1 AND \
            NOT u.isUnlisted ORDER BY u._id",
    )
    .bind(annotation_id)
    .fetch_all(connection)
    .await?)
}

/// The trimmed name of the dataset's data store.
pub(crate) async fn find_dataset_data_store(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<String> {
    Ok(
        sqlx::query_scalar("SELECT trim(_dataStore) FROM webknossos.datasets_ WHERE _id=$1")
            .bind(dataset_id)
            .fetch_one(connection)
            .await?,
    )
}

/// The user as the compact JSON `publicWrites` renders.
pub(crate) async fn find_compact_user(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(COMPACT_USER)
        .bind(id)
        .fetch_optional(connection)
        .await?)
}
