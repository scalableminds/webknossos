//! AiModelDAO and AiInferenceDAO, plus the user, organization and dataset lookups
//! of the AI model serializers.
//!
//! Callers own the connection and transaction; these functions only run SQL and
//! return rows. Mapping a missing row to an error is up to the caller.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

use super::{AiInference, AiModel};
use crate::{error::ApiResult, sql::Sql, users, util::id::ObjectId};

/// AiModelDAO.readAccessQ for alias `m`: models shared with or owned by the
/// user's organization, or pretrained; superuser-only models only for
/// superusers. AiModelDAO has no deleteAccessQ, so this is also delete access.
pub(crate) fn push_model_read_access<'a>(q: &mut Sql<'a>, user_id: &'a ObjectId) {
    q.push(
        r#"((m._id IN (
      SELECT a._aiModel FROM webknossos.aiModel_organizations AS a
      INNER JOIN webknossos.organizations AS o ON a._organization = o._id
      WHERE o._id IN (SELECT _organization FROM webknossos.users_ WHERE _id = "#,
    )
    .push_bind(user_id)
    .push(
        r#"))
    OR m._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = "#,
    )
    .push_bind(user_id)
    .push(
        r#")
    OR m.isPretrained)
  AND (NOT m.isSuperUserOnly OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
    (SELECT _multiUser FROM webknossos.users_ WHERE _id = "#,
    )
    .push_bind(user_id)
    .push("))))");
}

/// AiInferenceDAO.readAccessQ for alias `i`.
fn push_inference_read_access<'a>(q: &mut Sql<'a>, user_id: &'a ObjectId) {
    q.push("i._organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = ")
        .push_bind(user_id)
        .push(")");
}

/// Column list for [`AiModel`] (alias `m`, `_dataStore` trimmed as in AiModelDAO.parse;
/// shared organizations ordered as in findSharedOrganizationsFor).
pub(crate) const MODEL_COLUMNS: &str = r#"m._id AS id, m._organization AS organization,
  TRIM(m._dataStore) AS data_store, m._user AS user_id, m._trainingJob AS training_job, m.path,
  m.uploadToPathIsPending AS upload_to_path_is_pending, m.name, m.comment, m.category::text AS category,
  m.created, m.isSuperUserOnly AS is_super_user_only, m.isPretrained AS is_pretrained,
  ARRAY(SELECT ao._organization FROM webknossos.aiModel_organizations ao WHERE ao._aiModel = m._id
    ORDER BY ao._organization) AS shared_organizations"#;

const INFERENCE_COLUMNS: &str = r#"i._id AS id, i._aiModel AS ai_model, i._newDataset AS new_dataset,
  i._inferenceJob AS inference_job, i.newSegmentationLayerName AS new_segmentation_layer_name,
  i.maskAnnotationLayerName AS mask_annotation_layer_name, i.created"#;

/// UserService.compactWrites for `$1` (teams of the user's organization).
const COMPACT_USER: &str = r#"SELECT jsonb_build_object('id',u._id,'email',m.email,'firstName',m.firstName,'lastName',m.lastName,
    'isAdmin',u.isAdmin,'isDatasetManager',u.isDatasetManager,'isActive',NOT u.isDeactivated,'isAnonymous',false,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',team._id,'name',team.name,'isTeamManager',role.isTeamManager) ORDER BY team._id)
      FROM webknossos.user_team_roles role JOIN webknossos.teams_ team ON team._id=role._team WHERE role._user=u._id AND team._organization=u._organization),'[]'::jsonb))
    FROM webknossos.users_ u JOIN webknossos.multiUsers_ m ON m._id=u._multiUser WHERE u._id=$1"#;

/// AiModelDAO.findOne with the requesting user's read access. The row is not parsed;
/// see `AiModel::parse`.
pub(crate) async fn find_one(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    model_id: &ObjectId,
) -> ApiResult<Option<AiModel>> {
    let mut q = Sql::new("SELECT ");
    q.push(MODEL_COLUMNS)
        .push(" FROM webknossos.aiModels_ m WHERE m._id = ");
    q.push_bind(model_id).push(" AND ");
    push_model_read_access(&mut q, user_id);
    Ok(q.build_query_as().fetch_optional(&mut *connection).await?)
}

/// AiModelDAO.findAll. Scala has no ORDER BY; creation order is used for stability.
/// The rows are not parsed; see `AiModel::parse`.
pub(crate) async fn find_all(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Vec<AiModel>> {
    let mut q = Sql::new("SELECT ");
    q.push(MODEL_COLUMNS)
        .push(" FROM webknossos.aiModels_ m WHERE ");
    push_model_read_access(&mut q, user_id);
    q.push(" ORDER BY m.created, m._id");
    Ok(q.build_query_as().fetch_all(&mut *connection).await?)
}

/// Row lock on the model, so that concurrent changes of it are serialized.
pub(crate) async fn lock_one(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("SELECT _id FROM webknossos.aiModels WHERE _id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *connection)
        .await?;
    Ok(())
}

/// AiModelDAO.updateOne: name and comment.
pub(crate) async fn update_name_and_comment(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: &str,
    comment: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.aiModels SET name = $1, comment = $2, modified = NOW() WHERE _id = $3",
    )
    .bind(name)
    .bind(comment)
    .bind(id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiModelDAO.updatePath, then updateOne (path, name, comment, modified).
pub(crate) async fn update_path_name_and_comment(
    connection: &mut PgConnection,
    id: &ObjectId,
    path: &str,
    name: &str,
    comment: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE webknossos.aiModels SET path = $2, name = $3, comment = $4, modified = NOW() WHERE _id = $1",
    )
    .bind(id)
    .bind(path)
    .bind(name)
    .bind(comment)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiModelDAO.updateSharedOrganizations, delete part.
pub(crate) async fn delete_shared_organizations(
    connection: &mut PgConnection,
    model_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webknossos.aiModel_organizations WHERE _aiModel = $1")
        .bind(model_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// AiModelDAO.updateSharedOrganizations, insert part.
pub(crate) async fn insert_shared_organization(
    connection: &mut PgConnection,
    model_id: &ObjectId,
    organization: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.aiModel_organizations (_aiModel, _organization) VALUES ($1, $2)",
    )
    .bind(model_id)
    .bind(organization)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// Soft delete.
pub(crate) async fn delete_one(connection: &mut PgConnection, id: &ObjectId) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.aiModels SET isDeleted = TRUE WHERE _id = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// AiModelDAO.insertOne with a reserved upload path. It writes no shared organizations;
/// the owning organization is implied.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_one_with_path(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    data_store: &str,
    user_id: &ObjectId,
    path: &str,
    name: &str,
    comment: Option<&str>,
    category: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.aiModels (_id, _organization, _dataStore, _user, _trainingJob, path,
                  uploadToPathIsPending, name, comment, category, created, modified, isDeleted, isSuperUserOnly, isPretrained)
                  VALUES ($1, $2, $3, $4, NULL, $5, TRUE, $6, $7, $8::webknossos.AI_MODEL_CATEGORY, NOW(), NOW(), FALSE, FALSE, FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(data_store)
    .bind(user_id)
    .bind(path)
    .bind(name)
    .bind(comment)
    .bind(category)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiModelDAO.insertOne for a model that is trained by `training_job`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_one_for_training(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    data_store: &str,
    user_id: &ObjectId,
    training_job: &ObjectId,
    name: &str,
    comment: Option<&str>,
    category: Option<&str>,
    created: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.aiModels (_id, _organization, _dataStore, _user, _trainingJob, path,
          uploadToPathIsPending, name, comment, category, created, modified, isDeleted, isSuperUserOnly, isPretrained)
          VALUES ($1, $2, $3, $4, $5, NULL, TRUE, $6, $7, $8::webknossos.AI_MODEL_CATEGORY, $9, $9, FALSE, FALSE, FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(data_store)
    .bind(user_id)
    .bind(training_job)
    .bind(name)
    .bind(comment)
    .bind(category)
    .bind(created)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiModelDAO.insertTrainingAnnotation.
pub(crate) async fn insert_training_annotation(
    connection: &mut PgConnection,
    model_id: &ObjectId,
    annotation_id: &ObjectId,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO webknossos.aiModel_trainingAnnotations (_aiModel, _annotation) VALUES ($1, $2)",
    )
    .bind(model_id)
    .bind(annotation_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiModelDAO.findOneByName(name).reverse: any model readable by the user (also of other
/// organizations or pretrained) blocks the name.
pub(crate) async fn is_name_taken(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    name: &str,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.aiModels_ m WHERE m.name = ");
    q.push_bind(name).push(" AND ");
    push_model_read_access(&mut q, user_id);
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(&mut *connection).await?)
}

/// AiModelDAO.countByNameAndOrganization counts soft-deleted models, too.
pub(crate) async fn count_by_name_and_organization(
    pool: &PgPool,
    name: &str,
    organization: &str,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM webknossos.aiModels WHERE name = $1 AND _organization = $2",
    )
    .bind(name)
    .bind(organization)
    .fetch_one(pool)
    .await
}

/// The number of non-deleted inferences that reference the model.
pub(crate) async fn count_inferences_of_model(
    connection: &mut PgConnection,
    model_id: &ObjectId,
) -> ApiResult<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM webknossos.aiInferences_ WHERE _aiModel = $1")
            .bind(model_id)
            .fetch_one(&mut *connection)
            .await?,
    )
}

/// AiModelDAO.updateUploadToPathIsPending(false).
pub(crate) async fn update_upload_to_path_finished(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.aiModels SET uploadToPathIsPending = FALSE WHERE _id = $1")
        .bind(id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// DataStoreDAO.findOneByName with the user's access (onlyAllowedOrganization); returns the internal URL.
pub(crate) async fn find_data_store_url_for_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    name: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT url FROM webknossos.dataStores_ WHERE name = $2 AND ((onlyAllowedOrganization IS NULL)
          OR (onlyAllowedOrganization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $1)))"#,
    )
    .bind(user_id)
    .bind(name)
    .fetch_optional(&mut *connection)
    .await?)
}

/// OrganizationDAO.findAll ids (organizations of the user's account, or all for superusers).
pub(crate) async fn find_all_accessible_organization_ids(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.organizations_ WHERE
          (_id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser =
            (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1)))
          OR TRUE IN (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN
            (SELECT _multiUser FROM webknossos.users_ WHERE _id = $1))"#,
    )
    .bind(user_id)
    .fetch_all(&mut *connection)
    .await?)
}

/// UserDAO.findOne with the requesting user's read access: the user id.
pub(crate) async fn find_readable_user_id(
    connection: &mut PgConnection,
    requesting_user_id: &ObjectId,
    user_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    let mut q = Sql::new("SELECT usr._id FROM webknossos.users_ usr WHERE usr._id = ");
    q.push_bind(user_id).push(" AND ");
    users::push_read_access(&mut q, requesting_user_id.into());
    Ok(q.build_query_scalar()
        .fetch_optional(&mut *connection)
        .await?)
}

/// UserService.compactWrites of the user.
pub(crate) async fn find_compact_user(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(COMPACT_USER)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?)
}

/// OrganizationDAO.findOne (global): the AI plan. The outer `Option` is the organization
/// being found, the inner one the nullable column.
pub(crate) async fn find_ai_plan(
    pool: &PgPool,
    organization: &str,
) -> sqlx::Result<Option<Option<String>>> {
    sqlx::query_scalar("SELECT aiPlan::text FROM webknossos.organizations_ WHERE _id = $1")
        .bind(organization)
        .fetch_optional(pool)
        .await
}

/// Whether the dataset is readable by the user.
pub(crate) async fn is_dataset_readable(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<bool> {
    let mut q = Sql::new("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ d WHERE d._id = ");
    q.push_bind(dataset_id).push(" AND ");
    crate::dataset::access::push_read_predicate(&mut q, user_id.into(), None);
    q.push(")");
    Ok(q.build_query_scalar().fetch_one(&mut *connection).await?)
}

/// AiInferenceDAO.findAll has no ORDER BY; creation order is used for stability.
pub(crate) async fn find_all_inferences(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<Vec<AiInference>> {
    let mut q = Sql::new("SELECT ");
    q.push(INFERENCE_COLUMNS)
        .push(" FROM webknossos.aiInferences_ i WHERE ");
    push_inference_read_access(&mut q, user_id);
    q.push(" ORDER BY i.created, i._id");
    Ok(q.build_query_as().fetch_all(&mut *connection).await?)
}

/// AiInferenceDAO.findOne with the requesting user's read access.
pub(crate) async fn find_one_inference(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    id: &ObjectId,
) -> ApiResult<Option<AiInference>> {
    let mut q = Sql::new("SELECT ");
    q.push(INFERENCE_COLUMNS)
        .push(" FROM webknossos.aiInferences_ i WHERE i._id = ");
    q.push_bind(id).push(" AND ");
    push_inference_read_access(&mut q, user_id);
    Ok(q.build_query_as().fetch_optional(&mut *connection).await?)
}

/// AiInferenceDAO.insertOne.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_one_inference(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
    model_id: &ObjectId,
    annotation_id: Option<&ObjectId>,
    inference_job: &ObjectId,
    bounding_box: &str,
    mask_annotation_layer_name: Option<&str>,
    created: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.aiInferences (_id, _organization, _aiModel, _newDataset, _annotation,
          _inferenceJob, boundingBox, newSegmentationLayerName, maskAnnotationLayerName, created, modified, isDeleted)
          VALUES ($1, $2, $3, NULL, $4, $5, ('(' || $6 || ')')::webknossos.BOUNDING_BOX, 'segmentation', $7, $8, $8, FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(model_id)
    .bind(annotation_id)
    .bind(inference_job)
    .bind(bounding_box)
    .bind(mask_annotation_layer_name)
    .bind(created)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// AiInferenceDAO.findOneByJobId (row lock): the inference id.
pub(crate) async fn find_inference_id_by_job(
    connection: &mut PgConnection,
    job_id: &ObjectId,
) -> ApiResult<Option<ObjectId>> {
    Ok(sqlx::query_scalar(
        r#"SELECT _id FROM webknossos.aiInferences_ WHERE _inferenceJob = $1
          ORDER BY created, _id LIMIT 1 FOR UPDATE"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *connection)
    .await?)
}

/// AiInferenceDAO.updateDataset.
pub(crate) async fn update_inference_new_dataset(
    connection: &mut PgConnection,
    inference_id: &ObjectId,
    dataset_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("UPDATE webknossos.aiInferences SET _newDataset = $2 WHERE _id = $1")
        .bind(inference_id)
        .bind(dataset_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
