//! DatasetDAO read queries behind the dataset routes: lookups, the JSON renderings of a dataset,
//! its layers and datastore, the compact list, sharing tokens and allowed teams.
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgConnection, PgPool};

use super::{CompactDataset, DELETED_BY_USER, ListQuery, UNREPORTED};
use crate::{
    auth::AuthUser,
    dataset::dataset_dao::{push_edit_predicate, push_read_predicate},
    sql::Sql,
    util::id::ObjectId,
};

/// The oldest dataset of the user's organization with this import URL that the user can read.
pub(crate) async fn find_id_by_import_url(
    pool: &PgPool,
    user: &AuthUser,
    import_url: &str,
) -> sqlx::Result<Option<ObjectId>> {
    let mut q = Sql::new("SELECT d._id FROM webknossos.datasets_ d WHERE ");
    push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(" AND d._organization=")
        .push_bind(&user.organization_id)
        .push(" AND d.importURL=")
        .push_bind(import_url)
        .push(" ORDER BY d.created,d._id LIMIT 1");
    q.build_query_scalar().fetch_optional(pool).await
}

/// The organization of the oldest dataset with this name that the user can read.
pub(crate) async fn find_organization_by_name(
    pool: &PgPool,
    user: Option<&AuthUser>,
    sharing_token: Option<&str>,
    name: &str,
) -> sqlx::Result<Option<String>> {
    let mut q = Sql::new("SELECT d._organization FROM webknossos.datasets_ d WHERE ");
    push_read_predicate(&mut q, user.map(|u| &u.id).into(), sharing_token);
    q.push(" AND d.name=")
        .push_bind(name)
        .push(" ORDER BY d.created LIMIT 1");
    q.build_query_scalar().fetch_optional(pool).await
}

/// The disambiguation answer for a dataset (DatasetController.getDatasetIdFromNameAndOrganization).
#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatasetIdentity {
    pub id: ObjectId,
    pub name: String,
    pub organization: String,
    pub directory_name: String,
}

/// The oldest dataset with this directory name.
pub(crate) async fn find_by_directory_name(
    pool: &PgPool,
    organization: &str,
    name: &str,
) -> sqlx::Result<Option<DatasetIdentity>> {
    sqlx::query_as(
        "SELECT \
            d._id AS id,d.name,d._organization AS organization,d.directoryName AS directory_name \
            FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON \
            o._id=d._organization WHERE d._organization=$1 AND d.directoryName=$2 ORDER BY \
            d.created LIMIT 1",
    )
    .bind(organization)
    .bind(name)
    .fetch_optional(pool)
    .await
}

/// The active identities of the requester's multi-user in `organization`.
pub(crate) async fn find_identities_in_organization(
    pool: &PgPool,
    user_id: &ObjectId,
    organization: &str,
) -> sqlx::Result<Vec<AuthUser>> {
    sqlx::query_as(
        "SELECT identity._id AS id,identity._organization AS \
                organization_id,identity.isAdmin AS is_admin,identity.isDatasetManager AS \
                is_dataset_manager,multi.isSuperUser AS is_superuser FROM webknossos.users_ \
                identity JOIN webknossos.users_ requester ON \
                requester._multiUser=identity._multiUser JOIN webknossos.multiUsers_ multi ON \
                multi._id=identity._multiUser JOIN webknossos.organizations_ o ON \
                o._id=identity._organization WHERE requester._id=$1 AND \
                identity._organization=$2 AND NOT identity.isDeactivated ORDER BY identity._id",
    )
    .bind(user_id)
    .bind(organization)
    .fetch_all(pool)
    .await
}

/// (metadata, folder, organization, created) of the dataset.
pub(crate) async fn find_metadata_fields(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<(Value, ObjectId, String, chrono::DateTime<chrono::Utc>)> {
    sqlx::query_as(
        "SELECT metadata,_folder,_organization,created FROM webknossos.datasets_ WHERE _id=$1",
    )
    .bind(dataset_id)
    .fetch_one(connection)
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_metadata(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    description: Option<String>,
    name: Option<String>,
    sorting_key: chrono::DateTime<chrono::Utc>,
    is_public: bool,
    tags: Vec<String>,
    metadata: Value,
    folder: ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.datasets SET \
            description=$2,name=$3,sortingKey=$4,isPublic=$5,tags=$6,metadata=$7,_folder=$8 \
            WHERE _id=$1 AND NOT isDeleted",
    )
    .bind(dataset_id)
    .bind(description)
    .bind(name)
    .bind(sorting_key)
    .bind(is_public)
    .bind(tags)
    .bind(metadata)
    .bind(folder)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn find_organization_id(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<String> {
    sqlx::query_scalar("SELECT _organization FROM webknossos.datasets_ WHERE _id=$1")
        .bind(dataset_id)
        .fetch_one(pool)
        .await
}

/// Whether the user (or any identity of their multi-user) may see the organization.
pub(crate) async fn can_read_organization(
    pool: &PgPool,
    organization: &str,
    user: &AuthUser,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.organizations_ o WHERE o._id=$1 AND ($3 \
            OR EXISTS (SELECT 1 FROM webknossos.users_ identity JOIN webknossos.users_ \
            requesting_identity ON requesting_identity._multiUser=identity._multiUser WHERE \
            requesting_identity._id=$2 AND identity._organization=o._id)))",
    )
    .bind(organization)
    .bind(&user.id)
    .bind(user.is_superuser)
    .fetch_one(pool)
    .await
}

/// JSON of the users who can access the dataset, as visible to the requesting user.
pub(crate) async fn find_access_list(
    pool: &PgPool,
    user: &AuthUser,
    organization: &str,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
      'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
      'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,'isTeamManager',r.isTeamManager) ORDER BY t._id)
        FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team AND t._organization=u._organization WHERE r._user=u._id),'[]'::jsonb))
      FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser
      WHERE u._organization=$2 AND NOT u.isDeactivated AND NOT u.isUnlisted
      AND (u._id=$1 OR ($3 AND u._organization=$4) OR EXISTS (
        SELECT 1 FROM webknossos.user_team_roles target JOIN webknossos.user_team_roles requester ON requester._team=target._team
        JOIN webknossos.teams_ t ON t._id=requester._team AND t._organization=$4 AND t._organization=u._organization
        WHERE target._user=u._id AND requester._user=$1 AND requester.isTeamManager))
      AND (u.isAdmin OR u.isDatasetManager OR EXISTS (
        SELECT 1 FROM webknossos.user_team_roles r JOIN webknossos.teams_ t ON t._id=r._team AND t._organization=u._organization
        WHERE r._user=u._id AND (r._team IN (SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=$5)
          OR r._team IN (SELECT ft._team FROM webknossos.folder_allowedTeams ft JOIN webknossos.folder_paths fp ON fp._ancestor=ft._folder
            JOIN webknossos.datasets_ d ON d._folder=fp._descendant WHERE d._id=$5)))) ORDER BY u._id"#,
    )
    .bind(&user.id)
    .bind(organization)
    .bind(user.is_admin)
    .bind(&user.organization_id)
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

/// (isUsable, id/status/scale JSON, defaultViewConfiguration) of the dataset.
pub(crate) async fn find_data_source_header(
    pool: &PgPool,
    dataset_id: &ObjectId,
) -> sqlx::Result<(bool, Value, Option<Value>)> {
    type Row = (bool, Value, Option<Value>);
    let row: Row = sqlx::query_as(
        r#"SELECT isUsable,jsonb_build_object('id',jsonb_build_object('name',directoryName,'team',_organization),
      'status',status,'scale',CASE WHEN voxelSizeFactor IS NOT NULL THEN jsonb_build_object('factor',jsonb_build_array((voxelSizeFactor).x,(voxelSizeFactor).y,(voxelSizeFactor).z),
        'unit',COALESCE(voxelSizeUnit::text,'nanometer')) ELSE NULL END),defaultViewConfiguration FROM webknossos.datasets_ WHERE _id=$1"#,
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub(crate) async fn upsert_last_used_time(
    pool: &PgPool,
    dataset_id: &ObjectId,
    user_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO webknossos.dataset_lastUsedTimes (_dataset,_user,lastUsedTime) VALUES ($1,$2,NOW()) ON CONFLICT (_dataset,_user) DO UPDATE SET lastUsedTime = NOW()")
            .bind(dataset_id).bind(user_id).execute(pool).await?;
    Ok(())
}

/// DatasetService.publicWrites as JSON (with the datastore name only).
pub(crate) async fn find_public_json(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    dataset_id: &ObjectId,
) -> sqlx::Result<Value> {
    let user_id = user.map(|u| &u.id);
    let organization = user.map(|u| u.organization_id.as_str());
    let mut q = Sql::new(
        r#"SELECT jsonb_build_object(
      'id',d._id,'name',d.name,'owningOrganization',o._id,'directoryName',d.directoryName,
      'isActive',d.isUsable,'isPublic',d.isPublic,'description',d.description,
      'created',floor(extract(epoch from d.created)*1000)::bigint,
      'thumbnailCacheVersion',d.thumbnailCacheVersion,'isEditable',"#,
    );
    push_edit_predicate(&mut q, user_id.into());
    q.push(
        r#",
      'lastUsedByUser',COALESCE((SELECT floor(extract(epoch from lastUsedTime)*1000)::bigint
        FROM webknossos.dataset_lastUsedTimes l WHERE l._dataset=d._id AND l._user="#,
    )
    .push_bind(user_id)
    .push(
        r#"),0),
      'logoUrl',COALESCE(d.logoUrl,o.logoUrl),'sortingKey',floor(extract(epoch from d.sortingKey)*1000)::bigint,
      'metadata',d.metadata,'isUnreported',d.status="#,
    )
    .push_bind(UNREPORTED)
    .push(
        r#",'tags',ARRAY(SELECT unnest(d.tags) ORDER BY 1),
      'folderId',d._folder,'isVirtual',d.isVirtual,'creationType',d.creationType,
      'rootPath',d.rootPath,'rootRealPath',d.rootRealPath,'mirrorPath',d.mirrorPath,
      'uploaderFullName',(SELECT concat(m.firstName,' ',m.lastName) FROM webknossos.users_ up
        JOIN webknossos.multiUsers_ m ON m._id=up._multiUser WHERE up._id=d._uploader AND up._organization="#,
    )
    .push_bind(organization)
    .push("),\n      'allowedTeams',");
    push_visible_teams(
        &mut q,
        user_id,
        organization,
        "SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=d._id",
    );
    q.push(",\n      'allowedTeamsCumulative',");
    push_visible_teams(
        &mut q,
        user_id,
        organization,
        "SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset=d._id
          UNION SELECT ft._team FROM webknossos.folder_allowedTeams ft
          JOIN webknossos.folder_paths fp ON fp._ancestor=ft._folder WHERE fp._descendant=d._folder",
    );
    q.push(",\n      'usedStorageBytes',CASE WHEN d._organization=")
        .push_bind(organization)
        .push(
            r#" THEN
        COALESCE((SELECT sum(usedStorageBytes) FROM webknossos.organization_usedStorage_mags WHERE _dataset=d._id),0)
        + COALESCE((SELECT sum(usedStorageBytes) FROM webknossos.organization_usedStorage_attachments WHERE _dataset=d._id),0) ELSE 0 END,
      'dataSource',jsonb_build_object('id',jsonb_build_object('name',d.directoryName,'team',d._organization),
        'scale',CASE WHEN d.voxelSizeFactor IS NOT NULL THEN jsonb_build_object('factor',jsonb_build_array((d.voxelSizeFactor).x,(d.voxelSizeFactor).y,(d.voxelSizeFactor).z),
          'unit',COALESCE(d.voxelSizeUnit::text,'nanometer')) ELSE NULL END,'status',d.status,
        'defaultViewConfiguration',d.defaultViewConfiguration),
      'dataStore',jsonb_build_object('name',store.name))
      FROM webknossos.datasets_ d JOIN webknossos.organizations_ o ON o._id=d._organization
      JOIN webknossos.dataStores_ store ON store.name=trim(d._dataStore) WHERE d._id="#,
        )
        .push_bind(dataset_id);
    q.build_query_scalar().fetch_one(&mut *connection).await
}

/// The teams (alias `t`) among `team_ids` that are visible to the requester
/// as a JSON array: teams of the requester's organization they are a member
/// of or administer.
fn push_visible_teams<'a>(
    q: &mut Sql<'a>,
    user_id: Option<&'a ObjectId>,
    organization: Option<&'a str>,
    team_ids: &'static str,
) {
    q.push(
        "COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t._id,'name',t.name,
        'organization',o._id,'isOrganizationTeam',t.isOrganizationTeam)) FROM webknossos.teams_ t
        WHERE t._organization=",
    )
    .push_bind(organization)
    .push(" AND t._id IN (")
    .push(team_ids)
    .push(
        ")
        AND (EXISTS (SELECT 1 FROM webknossos.user_team_roles r WHERE r._team=t._id AND r._user=",
    )
    .push_bind(user_id)
    .push(")\n          OR EXISTS (SELECT 1 FROM webknossos.users_ u WHERE u._id=")
    .push_bind(user_id)
    .push(" AND u.isAdmin AND u._organization=t._organization))), '[]'::jsonb)");
}

/// (name, publicUrl, allowsUpload) of the datastore.
pub(crate) async fn find_datastore_public_fields(
    connection: &mut PgConnection,
    name: &str,
) -> sqlx::Result<(String, String, bool)> {
    sqlx::query_as("SELECT name,publicUrl,allowsUpload FROM webknossos.dataStores_ WHERE name=$1")
        .bind(name)
        .fetch_one(&mut *connection)
        .await
}

/// The distinct job commands supported by the datastore's workers, sorted.
pub(crate) async fn find_supported_job_commands(
    connection: &mut PgConnection,
    datastore_name: &str,
) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT DISTINCT unnest(supportedJobCommands) FROM webknossos.workers_ WHERE \
            _dataStore=$1 ORDER BY 1",
    )
    .bind(datastore_name)
    .fetch_all(&mut *connection)
    .await
}

/// JSON of the dataset's layers (without attachments), in name order.
pub(crate) async fn find_layers_json(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    use_real_paths: bool,
) -> sqlx::Result<Vec<Value>> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object('name',l.name,'category',l.category,
      'elementClass',l.elementClass,'dataFormat',l.dataFormat,
      'boundingBox',jsonb_build_object('topLeft',jsonb_build_array((l.boundingBox).x::int,(l.boundingBox).y::int,(l.boundingBox).z::int),
        'width',(l.boundingBox).width::int,'height',(l.boundingBox).height::int,'depth',(l.boundingBox).depth::int),
      'numChannels',CASE WHEN l.elementClass='uint24' THEN 3 ELSE 1 END,
      'defaultViewConfiguration',l.defaultViewConfiguration,'adminViewConfiguration',l.adminViewConfiguration,
      'largestSegmentId',l.largestSegmentId,'mappings',l.mappings,
      'coordinateTransformations',(SELECT jsonb_agg(jsonb_build_object('type',c.type,'matrix',c.matrix,'correspondences',c.correspondences) ORDER BY c.insertionOrderIndex)
        FROM webknossos.dataset_layer_coordinateTransformations c WHERE c._dataset=l._dataset AND c.layerName=l.name),
      'additionalAxes',(SELECT jsonb_agg(jsonb_build_object('name',a.name,'bounds',jsonb_build_array(a.lowerBound,a.upperBound),'index',a.index))
        FROM webknossos.dataset_layer_additionalAxes a WHERE a._dataset=l._dataset AND a.layerName=l.name),
      'mags',COALESCE((SELECT jsonb_agg(jsonb_build_object('mag',jsonb_build_array((m.mag).x::int,(m.mag).y::int,(m.mag).z::int),
        'path',CASE WHEN $2 THEN COALESCE(m.realPath,m.path) ELSE m.path END,'axisOrder',m.axisOrder,'channelIndex',m.channelIndex,'credentialId',m.credentialId)
        ORDER BY greatest((m.mag).x,(m.mag).y,(m.mag).z)) FROM webknossos.dataset_mags m
        WHERE m._dataset=l._dataset AND m.dataLayerName=l.name AND NOT m.uploadToPathIsPending AND NOT m.uploadIsPending),'[]'::jsonb))
      FROM webknossos.dataset_layers l WHERE l._dataset=$1 ORDER BY l.name"#,
    )
    .bind(dataset_id)
    .bind(use_real_paths)
    .fetch_all(&mut *connection)
    .await
}

/// (layer name, attachment type, attachment JSON) of the dataset's settled attachments.
pub(crate) async fn find_attachments_json(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    use_real_paths: bool,
) -> sqlx::Result<Vec<(String, String, Value)>> {
    // Play reads the attachments per layer through the primary key index, i.e. in name order.
    sqlx::query_as(
        r#"SELECT layerName,type::text,jsonb_build_object('name',name,
        'path',CASE WHEN $2 THEN COALESCE(realPath,path) ELSE path END,'dataFormat',dataFormat,'credentialId',credentialId) FROM webknossos.dataset_layer_attachments
        WHERE _dataset=$1 AND NOT uploadToPathIsPending AND NOT uploadIsPending
        ORDER BY layerName, name, type"#,
    )
    .bind(dataset_id)
    .bind(use_real_paths)
    .fetch_all(&mut *connection)
    .await
}

/// DatasetDAO.findAllCompactWithSearch: the readable datasets matching the list filters.
/// `organization`, the search `tokens` and the single `searched_id` are derived from `query` by the caller.
pub(crate) async fn find_all_compact(
    pool: &PgPool,
    user: Option<&AuthUser>,
    query: &ListQuery,
    organization: Option<&str>,
    tokens: &[String],
    searched_id: Option<&String>,
) -> sqlx::Result<Vec<CompactDataset>> {
    // Set-based like DatasetDAO.findAllCompactWithSearch: the selection (with its limit) is
    // filtered first, then layer names and storage are joined, and the JSON is built here
    // instead of with jsonb_build_object (together ~3x faster for thousands of datasets).
    // Grouped joins aggregate whole tables once, which only pays off for large selections;
    // small limits (search-as-you-type) use per-dataset lateral lookups instead.
    let per_dataset = query.limit.is_some_and(|limit| limit <= 500);
    let joins = if per_dataset {
        r#"LEFT JOIN LATERAL (SELECT array_agg(name ORDER BY name) AS names FROM webknossos.dataset_layers
        WHERE _dataset = d._id AND category = 'color') cl ON true
      LEFT JOIN LATERAL (SELECT array_agg(name ORDER BY name) AS names FROM webknossos.dataset_layers
        WHERE _dataset = d._id AND category = 'segmentation') sl ON true
      LEFT JOIN LATERAL (SELECT sum(usedStorageBytes) AS storage FROM webknossos.organization_usedStorage_mags
        WHERE _dataset = d._id) ms ON true
      LEFT JOIN LATERAL (SELECT sum(usedStorageBytes) AS storage FROM webknossos.organization_usedStorage_attachments
        WHERE _dataset = d._id) ats ON true"#
    } else {
        r#"LEFT JOIN (SELECT _dataset, array_agg(name ORDER BY name) AS names FROM webknossos.dataset_layers
        WHERE category = 'color' GROUP BY _dataset) cl ON cl._dataset = d._id
      LEFT JOIN (SELECT _dataset, array_agg(name ORDER BY name) AS names FROM webknossos.dataset_layers
        WHERE category = 'segmentation' GROUP BY _dataset) sl ON sl._dataset = d._id
      LEFT JOIN (SELECT _dataset, sum(usedStorageBytes) AS storage FROM webknossos.organization_usedStorage_mags
        GROUP BY _dataset) ms ON ms._dataset = d._id
      LEFT JOIN (SELECT _dataset, sum(usedStorageBytes) AS storage FROM webknossos.organization_usedStorage_attachments
        GROUP BY _dataset) ats ON ats._dataset = d._id"#
    };
    let user_id = user.map(|u| &u.id);
    let uploader = query.uploader_id.as_ref();
    let folder = query.folder_id.as_ref();
    let mut q = Sql::new(
        r#"SELECT d._id AS id, d.name, d._organization AS owning_organization, d._folder AS folder_id,
      d.isUsable AS is_active, d.directoryName AS directory_name,
      floor(extract(epoch from d.created)*1000)::bigint AS created,
      COALESCE("#,
    );
    push_edit_predicate(&mut q, user_id.into());
    q.push(
        r#", false) AS is_editable,
      COALESCE(floor(extract(epoch from lu.lastUsedTime)*1000)::bigint, 0) AS last_used_by_user,
      d.status, d.tags, "#,
    );
    push_is_unreported(&mut q);
    q.push(
        r#" AS is_unreported,
      COALESCE(cl.names, '{}') AS color_layer_names,
      COALESCE(sl.names, '{}') AS segmentation_layer_names,
      (CASE WHEN d._organization = "#,
    )
    .push_bind(user.map(|u| u.organization_id.as_str()))
    .push(
        r#" THEN COALESCE(ms.storage, 0) + COALESCE(ats.storage, 0) ELSE 0 END)::bigint
        AS used_storage_bytes,
      d.thumbnailCacheVersion AS thumbnail_cache_version,
      CASE WHEN "#,
    )
    .push_bind(query.include_annotation_count.unwrap_or(false))
    .push(" AND ")
    .push_bind(user_id)
    .push(
        r#"::text IS NOT NULL THEN (SELECT count(*)
         FROM webknossos.annotations_ a WHERE a._dataset = d._id AND a.typ = 'Explorational' AND a.state = 'Active'
         AND (a._user = "#,
    )
    .push_bind(user_id)
    .push(
        r#" OR (a.visibility IN ('Public', 'Internal') AND (
           EXISTS (SELECT 1 FROM webknossos.annotation_sharedTeams st JOIN webknossos.user_team_roles r ON r._team = st._team
             WHERE st._annotation = a._id AND r._user = "#,
    )
    .push_bind(user_id)
    .push(
        r#")
           OR EXISTS (SELECT 1 FROM webknossos.annotation_contributors c WHERE c._annotation = a._id AND c._user = "#,
    )
    .push_bind(user_id)
    .push(
        r#"))))) ELSE NULL END
        AS annotation_count
      FROM (SELECT d.* FROM webknossos.datasets_ d JOIN webknossos.organizations o ON o._id = d._organization
        WHERE "#,
    );
    push_read_predicate(&mut q, user_id.into(), None);
    // Catch-all filters (`value IS NULL OR ...`) keep one statement for every combination.
    q.push(" AND (")
        .push_bind(query.is_active)
        .push("::boolean IS NULL OR d.isUsable = ")
        .push_bind(query.is_active)
        .push(")");
    q.push(" AND (")
        .push_bind(query.is_unreported)
        .push("::boolean IS NULL OR ");
    push_is_unreported(&mut q);
    q.push(" = ").push_bind(query.is_unreported).push(")");
    q.push(" AND (")
        .push_bind(organization)
        .push("::text IS NULL OR d._organization = ")
        .push_bind(organization)
        .push(")");
    q.push(" AND (")
        .push_bind(uploader)
        .push("::text IS NULL OR d._uploader = ")
        .push_bind(uploader)
        .push(")");
    q.push(" AND (")
        .push_bind(folder)
        .push("::text IS NULL OR CASE WHEN ")
        .push_bind(query.include_subfolders.unwrap_or(false))
        .push(" THEN EXISTS (SELECT 1 FROM webknossos.folder_paths fp WHERE fp._ancestor = ")
        .push_bind(folder)
        .push(" AND fp._descendant = d._folder) ELSE d._folder = ")
        .push_bind(folder)
        .push(" END)");
    q.push(" AND (CASE WHEN ")
        .push_bind(searched_id)
        .push("::text IS NOT NULL THEN d._id = ")
        .push_bind(searched_id)
        .push(" ELSE NOT EXISTS (SELECT 1 FROM unnest(")
        .push_bind(tokens)
        .push(
            "::text[]) t WHERE position(t IN lower(d.name)) = 0 \
             AND position(t IN lower(d.directoryName)) = 0) END)",
        );
    q.push(" LIMIT ").push_bind(query.limit).push(
        ") d
      LEFT JOIN webknossos.dataset_lastUsedTimes lu ON lu._dataset = d._id AND lu._user = ",
    );
    q.push_bind(user_id).push("\n      ").push(joins);
    q.build_query_as::<CompactDataset>().fetch_all(pool).await
}

/// `(d.status IN (...))`: the dataset is no longer reported by its datastore.
fn push_is_unreported(q: &mut Sql<'_>) {
    q.push("(d.status IN (")
        .push_bind(UNREPORTED)
        .push(", ")
        .push_bind(DELETED_BY_USER)
        .push(", ")
        .push_bind(crate::dataset::lifecycle::CONVERSION_FAILED)
        .push("))");
}

/// Sets the sharing token unless one exists; returns the (new or existing) token of a
/// dataset of the user's organization that the user can read.
pub(crate) async fn set_sharing_token_if_absent(
    pool: &PgPool,
    user: &AuthUser,
    dataset_id: &ObjectId,
    new_token: String,
) -> sqlx::Result<Option<String>> {
    let mut q = Sql::new("UPDATE webknossos.datasets d SET sharingToken = COALESCE(sharingToken, ");
    q.push_bind(new_token)
        .push(") WHERE d._id = ")
        .push_bind(dataset_id)
        .push(" AND d._organization = ")
        .push_bind(&user.organization_id)
        .push(" AND NOT d.isDeleted AND ");
    push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(" RETURNING sharingToken");
    q.build_query_scalar().fetch_optional(pool).await
}

/// Clears the sharing token; returns the number of rows changed.
pub(crate) async fn clear_sharing_token(
    pool: &PgPool,
    user: &AuthUser,
    dataset_id: &ObjectId,
) -> sqlx::Result<u64> {
    let mut q = Sql::new("UPDATE webknossos.datasets d SET sharingToken = NULL WHERE d._id = ");
    q.push_bind(dataset_id)
        .push(" AND d._organization = ")
        .push_bind(&user.organization_id)
        .push(" AND NOT d.isDeleted AND ");
    push_read_predicate(&mut q, (&user.id).into(), None);
    q.push(" AND ");
    push_edit_predicate(&mut q, (&user.id).into());
    Ok(q.build().execute(pool).await?.rows_affected())
}

/// The teams of the user's organization they may grant dataset access to.
pub(crate) async fn find_manageable_team_ids(
    connection: &mut PgConnection,
    user: &AuthUser,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar(
        r#"SELECT t._id FROM webknossos.teams_ t WHERE t._organization = $2 AND
      ($3 OR EXISTS (SELECT 1 FROM webknossos.user_team_roles r
        WHERE r._team = t._id AND r._user = $1 AND ($4 OR r.isTeamManager)))"#,
    )
    .bind(&user.id)
    .bind(&user.organization_id)
    .bind(user.is_admin)
    .bind(user.is_dataset_manager)
    .fetch_all(connection)
    .await
}

pub(crate) async fn find_allowed_team_ids(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<Vec<ObjectId>> {
    sqlx::query_scalar("SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = $1")
        .bind(dataset_id)
        .fetch_all(connection)
        .await
}

pub(crate) async fn delete_allowed_teams(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_allowed_teams(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    team_ids: &[ObjectId],
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset, _team) SELECT $1, unnest($2::text[])")
        .bind(dataset_id).bind(team_ids).execute(connection).await?;
    Ok(())
}
