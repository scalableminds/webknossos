//! DatasetDAO and related queries behind the explore, add-virtual-dataset and duplicate routes.
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use crate::{error::ApiResult, sql::Sql, util::id::ObjectId};

#[derive(sqlx::FromRow)]
pub(crate) struct DuplicateSource {
    pub name: String,
    pub metadata: Value,
    pub description: Option<String>,
    pub status: String,
    pub factor: Option<Vec<f64>>,
    pub unit: Option<String>,
}

pub(crate) async fn insert_datastore_token(
    pool: &PgPool,
    value: &str,
    user_id: &ObjectId,
    expiry_millis: i64,
    idle_millis: i64,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens (_id, value, _user, lastUsedDateTime, expirationDateTime, idleTimeout, tokenType, created)
           VALUES ($1, $2, $3, statement_timestamp(), statement_timestamp() + $4::bigint * INTERVAL '1 millisecond', $5,
             'DataStore', statement_timestamp())"#,
    )
    .bind(ObjectId::new())
    .bind(value)
    .bind(user_id)
    .bind(expiry_millis)
    .bind(idle_millis)
    .execute(pool)
    .await?;
    Ok(())
}

/// The URL of the named datastore, or else of the first that allows uploads.
pub(crate) async fn find_explore_store_url(
    pool: &PgPool,
    name: Option<&String>,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT url FROM webknossos.dataStores_ WHERE ($1::text IS NULL AND allowsUpload OR name = $1) ORDER BY name LIMIT 1",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn find_root_folder(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<ObjectId> {
    Ok(
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1")
            .bind(organization_id)
            .fetch_one(connection)
            .await?,
    )
}

/// Folders (alias `f`) visible to `user`: below the root of an organization
/// they administer or manage datasets of, below or above a folder shared with
/// one of their teams, or above a public dataset or one shared with their teams.
fn push_visible_folder<'a>(q: &mut Sql<'a>, user: &'a ObjectId) {
    q.push(
        r#"(
        f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
          SELECT o._rootFolder FROM webknossos.organizations_ o JOIN webknossos.users_ u ON u._organization = o._id
          WHERE u._id = "#,
    )
    .push_bind(user)
    .push(
        r#" AND (u.isAdmin OR u.isDatasetManager)))
        OR f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
          SELECT at._folder FROM webknossos.folder_allowedTeams at
          JOIN webknossos.user_team_roles tr ON at._team = tr._team WHERE tr._user = "#,
    )
    .push_bind(user)
    .push(
        r#"))
        OR f._id IN (SELECT fp._ancestor FROM webknossos.folder_paths fp WHERE fp._descendant IN (
          SELECT at._folder FROM webknossos.folder_allowedTeams at
          JOIN webknossos.user_team_roles utr ON at._team = utr._team WHERE utr._user = "#,
    )
    .push_bind(user)
    .push(
        r#"))
        OR f._id IN (SELECT fp._ancestor FROM webknossos.folder_paths fp WHERE fp._descendant IN (
          SELECT d._folder FROM webknossos.datasets_ d LEFT JOIN webknossos.dataset_allowedTeams dt ON dt._dataset = d._id
          LEFT JOIN webknossos.user_team_roles utr ON dt._team = utr._team WHERE utr._user = "#,
    )
    .push_bind(user)
    .push(" OR d.isPublic)))");
}

/// (id, name, parent) of the folders directly below `root`, plus the root itself (parent `None`),
/// restricted to those visible to the user.
pub(crate) async fn find_visible_folders(
    connection: &mut PgConnection,
    root: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Vec<(ObjectId, String, Option<ObjectId>)>> {
    let mut q = Sql::new(
        r#"SELECT f._id, f.name, fp._ancestor FROM webknossos.folders_ f JOIN webknossos.folder_paths fp ON f._id = fp._descendant
           WHERE fp.depth = 1 AND f._id IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = "#,
    );
    q.push_bind(root).push(") AND ");
    push_visible_folder(&mut q, user_id);
    q.push(" UNION ALL SELECT f._id, f.name, NULL FROM webknossos.folders_ f WHERE f._id = ")
        .push_bind(root)
        .push(" AND ");
    push_visible_folder(&mut q, user_id);
    Ok(q.build_query_as().fetch_all(connection).await?)
}

pub(crate) async fn insert_folder(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: &str,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO webknossos.folders (_id, name, created) VALUES ($1, $2, NOW())")
        .bind(id)
        .bind(name)
        .execute(connection)
        .await?;
    Ok(())
}

/// Adds the folder below `parent` in the folder hierarchy.
pub(crate) async fn insert_folder_paths(
    connection: &mut PgConnection,
    id: &ObjectId,
    parent: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
               SELECT _ancestor, $1, depth + 1 FROM webknossos.folder_paths WHERE _descendant = $2
               UNION ALL SELECT $1, $1, 0"#,
    )
    .bind(id)
    .bind(parent)
    .execute(connection)
    .await?;
    Ok(())
}

/// (name, url) of the first datastore that allows uploads and is open to the organization.
pub(crate) async fn find_upload_store(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<Option<(String, String)>> {
    Ok(sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE allowsUpload AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name LIMIT 1",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await?)
}

/// (name, url) of the named datastore if it is open to the organization.
pub(crate) async fn find_store_for_organization(
    pool: &PgPool,
    name: &str,
    organization_id: &str,
) -> ApiResult<Option<(String, String)>> {
    Ok(sqlx::query_as(
        "SELECT name, url FROM webknossos.dataStores_ WHERE name = $1 AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $2)",
    )
    .bind(name)
    .bind(organization_id)
    .fetch_optional(pool)
    .await?)
}

/// Whether the user manages a team of the organization.
pub(crate) async fn is_team_manager(
    pool: &PgPool,
    user_id: &ObjectId,
    organization_id: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id = r._team WHERE r._user = $1 AND r.isTeamManager AND t._organization = $2)",
    )
    .bind(user_id)
    .bind(organization_id)
    .fetch_one(pool)
    .await?)
}

/// Name, metadata, description, status and voxel size of the dataset.
pub(crate) async fn find_duplicate_source(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> ApiResult<DuplicateSource> {
    Ok(sqlx::query_as(
        r#"SELECT name, metadata, description, status,
             CASE WHEN voxelSizeFactor IS NULL THEN NULL ELSE ARRAY[(voxelSizeFactor).x, (voxelSizeFactor).y, (voxelSizeFactor).z] END AS factor,
             COALESCE(voxelSizeUnit::text, 'nanometer') AS unit
           FROM webknossos.datasets_ WHERE _id = $1"#,
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await?)
}

pub(crate) async fn organization_exists(pool: &PgPool, organization_id: &str) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ WHERE _id = $1)",
        )
        .bind(organization_id)
        .fetch_one(pool)
        .await?,
    )
}
