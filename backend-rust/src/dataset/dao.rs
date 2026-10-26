//! DatasetDAO: the datasets, dataset_layers, dataset_mags, dataset_layer_attachments and
//! related queries, plus the access predicates other domains embed in their own queries.
//!
//! Callers own the connection and transaction; these functions only run SQL
//! and return rows. Mapping a missing row to an error is up to the caller.
use sqlx::{PgConnection, PgPool};

use crate::{
    dataset::source::{LayerKind, StaticLayer},
    error::ApiResult,
    sql::{Arg, PushArg, Sql},
    util::id::ObjectId,
};

// --- access ---

/// Datasets (alias `d`) of the requester's organization reachable through a
/// live team of it, directly or via a folder grant. Uncorrelated: depends only on `user`.
fn push_team_grant<'a>(q: &mut Sql<'a>, user: Arg<'a>, managers_only: bool) {
    let manager = if managers_only {
        " AND r.isTeamManager"
    } else {
        ""
    };
    q.push(
        "(d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = ",
    )
    .push_arg(user)
    .push(
        ") AND (
      d._id IN (SELECT dt._dataset FROM webknossos.dataset_allowedTeams dt
        JOIN webknossos.user_team_roles r ON r._team = dt._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = ",
    )
    .push_arg(user)
    .push(manager)
    .push(
        ")
      OR d._folder IN (SELECT fp._descendant FROM webknossos.folder_paths fp
        JOIN webknossos.folder_allowedTeams ft ON ft._folder = fp._ancestor
        JOIN webknossos.user_team_roles r ON r._team = ft._team
        JOIN webknossos.teams_ t ON t._id = r._team
        JOIN webknossos.users_ member ON member._id = r._user AND member._organization = t._organization
        WHERE r._user = ",
    )
    .push_arg(user)
    .push(manager)
    .push(")))");
}

/// Datasets (alias `d`) of an organization the user administers or manages datasets of.
fn push_manager_grant<'a>(q: &mut Sql<'a>, user: Arg<'a>) {
    q.push("d._organization IN (SELECT u._organization FROM webknossos.users_ u WHERE u._id = ")
        .push_arg(user)
        .push(" AND (u.isAdmin OR u.isDatasetManager))");
}

/// DatasetDAO read access for a `datasets_` row aliased `d`. The user and
/// sharing-token grants are additive, as in URLSharing's fallback context. A
/// private-link token only grants access until the link expires
/// (DatasetDAO.anonymousReadAccessQ).
///
/// Team grants only count for live teams of the requesting (live) user's own organization,
/// which must also own the dataset. Every subquery is uncorrelated (`IN (…)` over sets that
/// depend only on the user and token), so PostgreSQL evaluates each once per statement as a
/// hashed subplan instead of once per dataset row; list queries over thousands of datasets
/// depend on this (DatasetDAO.readAccessQ uses the same shape).
pub fn push_read_predicate<'a>(q: &mut Sql<'a>, user: Arg<'a>, sharing_token: Option<&'a str>) {
    q.push("(d.isPublic OR ");
    push_manager_grant(q, user);
    q.push(" OR ");
    push_team_grant(q, user, false);
    if let Some(token) = sharing_token {
        q.push(" OR d.sharingToken = ")
            .push_bind(token)
            .push(
                " OR d._id IN (
    SELECT a._dataset FROM webknossos.annotation_privateLinks_ link
    JOIN webknossos.annotations_ a ON a._id = link._annotation
    WHERE link.accessToken = ",
            )
            .push_bind(token)
            .push(
                " AND (link.expirationDateTime IS NULL OR link.expirationDateTime > statement_timestamp()))",
            );
    }
    q.push(")");
}

/// DatasetService.isEditableBy for alias `d`. Being an uploader or superuser
/// alone does not grant editing. Admins and dataset managers may only edit
/// datasets of their own organization (isAdminOf, isDatasetManagerOf); callers
/// needing read access must check it separately, just like the Scala
/// controllers. Uncorrelated like [`push_read_predicate`].
pub fn push_edit_predicate<'a>(q: &mut Sql<'a>, user: Arg<'a>) {
    q.push("(");
    push_manager_grant(q, user);
    q.push(" OR ");
    push_team_grant(q, user, true);
    q.push(")");
}

/// Whether the dataset exists and is readable by `user` (or by the sharing token).
pub(crate) async fn is_readable(
    pool: &PgPool,
    user: Option<&crate::auth::AuthUser>,
    dataset_id: &ObjectId,
    sharing_token: Option<&str>,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset_id).push(" AND ");
    push_read_predicate(&mut q, user.map(|u| &u.id).into(), sharing_token);
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

/// Whether the dataset exists and is editable by `user`.
pub(crate) async fn is_editable(
    pool: &PgPool,
    user: &crate::auth::AuthUser,
    dataset_id: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset_id).push(" AND ");
    push_edit_predicate(&mut q, (&user.id).into());
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(pool).await?)
}

/// Whether the dataset is readable by the user, evaluated on an existing connection
/// (for example inside the caller's transaction).
pub(crate) async fn is_readable_on_connection(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT ");
    push_read_predicate(&mut q, user_id.into(), None);
    q.push(" FROM webknossos.datasets_ d WHERE d._id=")
        .push_bind(dataset_id);
    Ok(q.build_query_scalar().fetch_one(connection).await?)
}

/// Row-locks the dataset (`FOR UPDATE`); `None` if it does not exist.
pub(crate) async fn find_id_for_update(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(
        sqlx::query_scalar("SELECT _id FROM webknossos.datasets_ WHERE _id = $1 FOR UPDATE")
            .bind(dataset_id)
            .fetch_optional(connection)
            .await?,
    )
}

/// Share-locks the live teams of an organization.
pub(crate) async fn lock_organization_teams(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<()> {
    sqlx::query(
        "SELECT _id FROM webknossos.teams_ WHERE _organization = $1 ORDER BY _id FOR SHARE",
    )
    .bind(organization_id)
    .fetch_all(connection)
    .await?;
    Ok(())
}

/// Share-locks the team memberships of a user.
pub(crate) async fn lock_user_team_roles(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "SELECT _team FROM webknossos.user_team_roles WHERE _user = $1 ORDER BY _team FOR SHARE",
    )
    .bind(user_id)
    .fetch_all(connection)
    .await?;
    Ok(())
}

/// Share-locks the folder grants the dataset inherits from its folder ancestors.
pub(crate) async fn lock_inherited_folder_grants(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("SELECT ft._folder FROM webknossos.folder_allowedTeams ft JOIN webknossos.folder_paths fp ON fp._ancestor = ft._folder JOIN webknossos.datasets_ d ON d._folder = fp._descendant WHERE d._id = $1 ORDER BY ft._folder, ft._team FOR SHARE OF ft, fp")
        .bind(dataset_id).fetch_all(connection).await?;
    Ok(())
}

/// (read, edit) access of the user to the dataset.
pub(crate) async fn read_and_edit_access(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<(bool, bool)> {
    let mut q = Sql::new("SELECT ");
    push_read_predicate(&mut q, user_id.into(), None);
    q.push(", ");
    push_edit_predicate(&mut q, user_id.into());
    q.push(" FROM webknossos.datasets_ d WHERE d._id = ")
        .push_bind(dataset_id);
    Ok(q.build_query_as().fetch_one(connection).await?)
}

// --- layers, mags, attachments written by DatasetLayerDAO.updateLayers ---

/// Deletes the dataset's layers that are not in `names`.
pub(crate) async fn delete_layers_not_in(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    names: &[&str],
) -> ApiResult<()> {
    sqlx::query(
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1 AND NOT (name = ANY($2))",
    )
    .bind(dataset_id)
    .bind(names)
    .execute(connection)
    .await?;
    Ok(())
}

/// Inserts or updates one layer (bounding box, kind-specific columns, view configurations).
pub(crate) async fn upsert_layer(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer: &StaticLayer,
) -> ApiResult<()> {
    let bbox = &layer.bounding_box;
    let top_left = bbox.top_left;
    let [x, y, z, width, height, depth] = [
        top_left.x,
        top_left.y,
        top_left.z,
        bbox.width,
        bbox.height,
        bbox.depth,
    ]
    .map(f64::from);
    let default = layer
        .default_view_configuration
        .clone()
        .map(serde_json::Value::Object);
    let admin = layer
        .admin_view_configuration
        .clone()
        .map(serde_json::Value::Object);
    let element_class = layer.element_class.as_str();
    let data_format = layer.data_format.as_str();
    let channels = layer.num_channels() as i32;
    match &layer.kind {
        LayerKind::Segmentation {
            largest_segment_id,
            mappings,
        } => {
            sqlx::query(
                r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'segmentation', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12, $13, $14::webknossos.DATASET_LAYER_DATAFORMAT, $15)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, largestSegmentId = EXCLUDED.largestSegmentId, mappings = EXCLUDED.mappings,
                      defaultViewConfiguration = EXCLUDED.defaultViewConfiguration, adminViewConfiguration = EXCLUDED.adminViewConfiguration,
                      numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#,
            )
            .bind(dataset_id)
            .bind(&layer.name)
            .bind(element_class)
            .bind(x)
            .bind(y)
            .bind(z)
            .bind(width)
            .bind(height)
            .bind(depth)
            .bind(largest_segment_id.map(|id| id as i64))
            .bind(mappings.clone().unwrap_or_default())
            .bind(default)
            .bind(admin)
            .bind(data_format)
            .bind(channels)
            .execute(connection)
            .await?;
        }
        LayerKind::Color => {
            sqlx::query(r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'color', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12::webknossos.DATASET_LAYER_DATAFORMAT, $13)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, defaultViewConfiguration = EXCLUDED.defaultViewConfiguration,
                      adminViewConfiguration = EXCLUDED.adminViewConfiguration, numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#)
                    .bind(dataset_id).bind(&layer.name).bind(element_class)
                    .bind(x).bind(y).bind(z).bind(width).bind(height).bind(depth)
                    .bind(default).bind(admin).bind(data_format).bind(channels)
                    .execute(connection).await?;
        }
    }
    Ok(())
}

/// Deletes the dataset's mags, except mags of a pending upload.
pub(crate) async fn delete_settled_mags(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.dataset_mags WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(connection).await?;
    Ok(())
}

/// Inserts one mag of a layer (settled, not pending an upload).
pub(crate) async fn insert_mag(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    mag: &crate::dataset::source::MagLocator,
) -> ApiResult<()> {
    let [mx, my, mz] = [mag.mag.x, mag.mag.y, mag.mag.z].map(f64::from);
    let path = mag.path.as_ref().map(ToString::to_string);
    let axis_order = mag.axis_order.map(|order| serde_json::json!(order));
    sqlx::query(r#"INSERT INTO webknossos.dataset_mags(_dataset, dataLayerName, mag, path, axisOrder, channelIndex, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, ROW($3,$4,$5)::webknossos.VECTOR3, $6, $7, $8, $9, false, false)"#)
                .bind(dataset_id).bind(layer_name).bind(mx).bind(my).bind(mz)
                .bind(path).bind(axis_order).bind(mag.channel_index).bind(&mag.credential_id)
                .execute(connection).await?;
    Ok(())
}

pub(crate) async fn delete_coordinate_transformations(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
    )
    .bind(dataset_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_coordinate_transformation(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    transformation_type: &str,
    matrix: serde_json::Value,
    correspondences: serde_json::Value,
    insertion_order_index: i32,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.dataset_layer_coordinateTransformations(_dataset, layerName, type, matrix, correspondences, insertionOrderIndex) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(dataset_id).bind(layer_name).bind(transformation_type)
        .bind(matrix)
        .bind(correspondences)
        .bind(insertion_order_index)
        .execute(connection).await?;
    Ok(())
}

/// Deletes the dataset's attachments, except attachments of a pending upload.
pub(crate) async fn delete_settled_attachments(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(connection).await?;
    Ok(())
}

/// Inserts one attachment of a layer (settled, not pending an upload).
pub(crate) async fn insert_attachment(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    attachment_type: webknossos_common::enums::LayerAttachmentType,
    attachment: &crate::dataset::source::LayerAttachment,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.dataset_layer_attachments(_dataset, layerName, name, path, type, dataFormat, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, $7, false, false)"#,
    )
    .bind(dataset_id)
    .bind(layer_name)
    .bind(&attachment.name)
    .bind(attachment.path.to_string())
    .bind(attachment_type.as_str())
    .bind(attachment.data_format.as_str())
    .bind(&attachment.credential_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(crate) async fn delete_additional_axes(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_additional_axis(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    layer_name: &str,
    axis: &crate::dataset::source::AdditionalAxis,
    lower_bound: i32,
    upper_bound: i32,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.dataset_layer_additionalAxes(_dataset, layerName, name, lowerBound, upperBound, index) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(dataset_id).bind(layer_name).bind(&axis.name)
        .bind(lower_bound).bind(upper_bound).bind(axis.index)
        .execute(connection).await?;
    Ok(())
}

/// Whether the dataset is usable.
pub(crate) async fn find_is_usable(
    executor: impl sqlx::PgExecutor<'_>,
    dataset_id: &ObjectId,
) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT isUsable FROM webknossos.datasets_ WHERE _id = $1")
            .bind(dataset_id)
            .fetch_one(executor)
            .await?,
    )
}

pub(crate) async fn find_directory_name(
    executor: impl sqlx::PgExecutor<'_>,
    dataset_id: &ObjectId,
) -> ApiResult<String> {
    Ok(
        sqlx::query_scalar("SELECT directoryName FROM webknossos.datasets_ WHERE _id = $1")
            .bind(dataset_id)
            .fetch_one(executor)
            .await?,
    )
}

/// UPDATE of a dataset's last activity timestamp for the user (users table).
pub(crate) async fn touch_user_last_activity(pool: &PgPool, user_id: ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.users SET lastActivity = NOW() WHERE _id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// --- compose ---

/// The name of the first datastore that allows uploads and is open to the organization.
pub(crate) async fn find_upload_store_name(
    connection: &mut PgConnection,
    organization_id: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT name FROM webknossos.dataStores_ WHERE allowsUpload AND (onlyAllowedOrganization IS NULL OR onlyAllowedOrganization = $1) ORDER BY name LIMIT 1",
    )
    .bind(organization_id)
    .fetch_optional(connection)
    .await?)
}

/// Marks the dataset usable with the data source's voxel size.
pub(crate) async fn update_voxel_size_usable(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    source: &crate::dataset::source::UsableDataSource,
) -> ApiResult<()> {
    sqlx::query(
        r#"UPDATE webknossos.datasets SET inboxSourceHash = NULL, isUsable = true, status = '',
             voxelSizeFactor = ROW($2, $3, $4)::webknossos.VECTOR3, voxelSizeUnit = $5::webknossos.LENGTH_UNIT
           WHERE _id = $1"#,
    )
    .bind(dataset_id)
    .bind(source.scale.factor.x)
    .bind(source.scale.factor.y)
    .bind(source.scale.factor.z)
    .bind(source.scale.unit.as_str())
    .execute(connection)
    .await?;
    Ok(())
}

// --- remote paths to delete ---

/// The paths queued for deletion by the external path deletion service, oldest first.
pub(crate) async fn find_paths_to_delete(pool: &PgPool) -> ApiResult<Vec<String>> {
    Ok(
        sqlx::query_scalar("SELECT path FROM webknossos.remote_paths_to_delete ORDER BY created")
            .fetch_all(pool)
            .await?,
    )
}

pub(crate) async fn delete_paths_to_delete(pool: &PgPool, paths: &[String]) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.remote_paths_to_delete WHERE path = ANY($1)")
        .bind(paths)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn insert_paths_to_delete(pool: &PgPool, paths: &[String]) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.remote_paths_to_delete (path) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING")
            .bind(paths)
            .execute(pool)
            .await?;
    Ok(())
}

pub(crate) async fn update_folder_and_uploader(
    connection: &mut PgConnection,
    dataset_id: &ObjectId,
    folder: &ObjectId,
    uploader: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(dataset_id)
        .bind(folder)
        .bind(uploader)
        .execute(connection)
        .await?;
    Ok(())
}
