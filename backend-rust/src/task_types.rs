use axum::{Json as ResponseJson, Router, extract::State, routing::get};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json, Path},
    id::ObjectId,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/taskTypes", get(list).post(create))
        .route("/taskTypes/{id}", get(read).put(update).delete(delete))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum TracingType {
    Skeleton,
    Volume,
    Hybrid,
}
impl TracingType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Skeleton => "skeleton",
            Self::Volume => "volume",
            Self::Hybrid => "hybrid",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum TracingMode {
    Orthogonal,
    Flight,
}
impl TracingMode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Orthogonal => "orthogonal",
            Self::Flight => "flight",
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
struct MagRestrictions {
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<i32>,
}
fn true_value() -> bool {
    true
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationSettings {
    allowed_modes: Vec<TracingMode>,
    preferred_mode: Option<TracingMode>,
    #[serde(default = "true_value")]
    branch_points_allowed: bool,
    #[serde(default = "true_value")]
    soma_clicking_allowed: bool,
    #[serde(default = "true_value")]
    volume_interpolation_allowed: bool,
    #[serde(default)]
    merger_mode: bool,
    #[serde(default)]
    mag_restrictions: MagRestrictions,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskTypeParameters {
    summary: String,
    description: String,
    #[serde(deserialize_with = "crate::id::deserialize_string")]
    team_id: String,
    settings: AnnotationSettings,
    recommended_configuration: Option<Value>,
    tracing_type: TracingType,
}

fn validate(parameters: &TaskTypeParameters) -> ApiResult<()> {
    let length = parameters.summary.encode_utf16().count();
    if length < 2 {
        return Err(ApiError::bad_request("taskType.summaryTooShort"));
    }
    if length > 50 {
        return Err(ApiError::bad_request("taskType.summaryTooLong"));
    }
    ObjectId::parse(&parameters.team_id)?;
    // The database requires JSON objects even though the controller accepts JsValue.
    if parameters
        .recommended_configuration
        .as_ref()
        .is_some_and(|v| !v.is_object())
    {
        return Err(ApiError::bad_request(
            "taskType.recommendedConfigurationInvalid",
        ));
    }
    Ok(())
}

pub(crate) const PUBLIC_TASK_TYPE: &str = r#"SELECT jsonb_build_object(
 'id',tt._id,'summary',tt.summary,'description',tt.description,'teamId',tt._team,
 'teamName',team.name,'settings',jsonb_strip_nulls(jsonb_build_object(
    'allowedModes',tt.settings_allowedmodes,'preferredMode',tt.settings_preferredmode,
    'branchPointsAllowed',tt.settings_branchpointsallowed,'somaClickingAllowed',tt.settings_somaclickingallowed,
    'volumeInterpolationAllowed',tt.settings_volumeinterpolationallowed,'mergerMode',tt.settings_mergermode,
    'magRestrictions',jsonb_build_object('min',tt.settings_magrestrictions_min,'max',tt.settings_magrestrictions_max))),
 'recommendedConfiguration',tt.recommendedconfiguration,'tracingType',tt.tracingtype
) FROM webknossos.tasktypes_ tt JOIN webknossos.teams_ team ON team._id=tt._team "#;
const ACCESS: &str = " tt._organization=$2 AND ($3 OR EXISTS(SELECT 1 FROM webknossos.user_team_roles WHERE _user=$1 AND _team=tt._team)) ";

async fn public_json<'e, E: sqlx::Executor<'e, Database = sqlx::Postgres>>(
    executor: E,
    user: &AuthUser,
    id: &str,
) -> ApiResult<Value> {
    ObjectId::parse(id)?;
    let query = format!("{PUBLIC_TASK_TYPE} WHERE {ACCESS} AND tt._id=$4");
    sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .bind(id)
        .fetch_optional(executor)
        .await?
        .ok_or_else(|| ApiError::not_found("taskType.notFound"))
}
async fn check_manage(pool: &PgPool, user: &AuthUser, team: &str) -> ApiResult<()> {
    if !user.can_manage_team(pool, team).await? {
        return Err(ApiError::forbidden("notAllowed"));
    }
    Ok(())
}

async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<ResponseJson<Value>> {
    let query = format!("{PUBLIC_TASK_TYPE} WHERE {ACCESS}");
    let values: Vec<Value> = sqlx::query_scalar(&query)
        .bind(&user.id)
        .bind(&user.organization_id)
        .bind(user.is_admin)
        .fetch_all(&state.pool)
        .await?;
    Ok(ResponseJson(Value::Array(values)))
}
async fn read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let value = public_json(&state.pool, &user, &id).await?;
    check_manage(
        &state.pool,
        &user,
        value["teamId"].as_str().ok_or_else(ApiError::internal)?,
    )
    .await?;
    Ok(ResponseJson(value))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(parameters): Json<TaskTypeParameters>,
) -> ApiResult<ResponseJson<Value>> {
    validate(&parameters)?;
    let id = ObjectId::new().to_string();
    let mut tx = state.pool.begin().await?;
    if !crate::projects::can_manage_team_in_tx(&mut tx, &user, &parameters.team_id).await? {
        return Err(ApiError::forbidden("notAllowed"));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!(
            "taskType:{}:{}",
            user.organization_id, parameters.summary
        ))
        .execute(&mut *tx)
        .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ WHERE _organization=$1 AND summary=$2)",
    )
    .bind(&user.organization_id)
    .bind(&parameters.summary)
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        return Err(ApiError::conflict("taskType.summaryTaken"));
    }
    let modes: Vec<&str> = parameters
        .settings
        .allowed_modes
        .iter()
        .map(TracingMode::as_str)
        .collect();
    sqlx::query("INSERT INTO webknossos.tasktypes(_id,_organization,_team,summary,description,settings_allowedmodes,settings_preferredmode,settings_branchpointsallowed,settings_somaclickingallowed,settings_volumeinterpolationallowed,settings_mergermode,settings_magrestrictions_min,settings_magrestrictions_max,recommendedconfiguration,tracingtype) VALUES($1,$2,$3,$4,$5,$6::text[]::webknossos.tasktype_modes[],$7::text::webknossos.tasktype_modes,$8,$9,$10,$11,$12,$13,$14,$15::text::webknossos.tasktype_tracingtypes)")
        .bind(&id).bind(&user.organization_id).bind(&parameters.team_id).bind(&parameters.summary).bind(&parameters.description)
        .bind(modes).bind(parameters.settings.preferred_mode.as_ref().map(TracingMode::as_str))
        .bind(parameters.settings.branch_points_allowed).bind(parameters.settings.soma_clicking_allowed)
        .bind(parameters.settings.volume_interpolation_allowed).bind(parameters.settings.merger_mode)
        .bind(parameters.settings.mag_restrictions.min).bind(parameters.settings.mag_restrictions.max)
        .bind(&parameters.recommended_configuration).bind(parameters.tracing_type.as_str()).execute(&mut *tx).await?;
    let response = public_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(response))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(parameters): Json<TaskTypeParameters>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    validate(&parameters)?;
    let mut tx = state.pool.begin().await?;
    lock_task_type(&mut tx, &id, &user.organization_id).await?;
    let existing = public_json(&mut *tx, &user, &id).await?;
    if !crate::projects::can_manage_team_in_tx(
        &mut tx,
        &user,
        existing["teamId"].as_str().ok_or_else(ApiError::internal)?,
    )
    .await?
        || !crate::projects::can_manage_team_in_tx(&mut tx, &user, &parameters.team_id).await?
    {
        return Err(ApiError::forbidden("notAllowed"));
    }
    if existing["tracingType"] != json!(parameters.tracing_type) {
        return Err(ApiError::bad_request("taskType.tracingTypeImmutable"));
    }
    if existing["settings"]["magRestrictions"] != json!(parameters.settings.mag_restrictions) {
        return Err(ApiError::bad_request("taskType.magRestrictionsImmutable"));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!(
            "taskType:{}:{}",
            user.organization_id, parameters.summary
        ))
        .execute(&mut *tx)
        .await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webknossos.tasktypes_ WHERE _organization=$1 AND summary=$2 AND _id<>$3)")
        .bind(&user.organization_id).bind(&parameters.summary).bind(&id).fetch_one(&mut *tx).await?;
    if exists {
        return Err(ApiError::conflict("taskType.summaryTaken"));
    }
    let modes: Vec<&str> = parameters
        .settings
        .allowed_modes
        .iter()
        .map(TracingMode::as_str)
        .collect();
    sqlx::query("UPDATE webknossos.tasktypes SET _team=$2,summary=$3,description=$4,settings_allowedmodes=$5::text[]::webknossos.tasktype_modes[],settings_preferredmode=$6::text::webknossos.tasktype_modes,settings_branchpointsallowed=$7,settings_somaclickingallowed=$8,settings_volumeinterpolationallowed=$9,settings_mergermode=$10,recommendedconfiguration=$11 WHERE _id=$1 AND NOT isdeleted")
        .bind(&id).bind(&parameters.team_id).bind(&parameters.summary).bind(&parameters.description).bind(modes)
        .bind(parameters.settings.preferred_mode.as_ref().map(TracingMode::as_str))
        .bind(parameters.settings.branch_points_allowed).bind(parameters.settings.soma_clicking_allowed)
        .bind(parameters.settings.volume_interpolation_allowed).bind(parameters.settings.merger_mode)
        .bind(&parameters.recommended_configuration).execute(&mut *tx).await?;
    let mut value = public_json(&mut *tx, &user, &id).await?;
    tx.commit().await?;
    value["messages"] = json!([{"success":"taskType.editSuccess"}]);
    Ok(ResponseJson(value))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<ResponseJson<Value>> {
    let id = ObjectId::parse_path(&id)?.to_string();
    let mut tx = state.pool.begin().await?;
    lock_task_type(&mut tx, &id, &user.organization_id).await?;
    let existing = public_json(&mut *tx, &user, &id).await?;
    if !crate::projects::can_manage_team_in_tx(
        &mut tx,
        &user,
        existing["teamId"].as_str().ok_or_else(ApiError::internal)?,
    )
    .await?
    {
        return Err(ApiError::forbidden("notAllowed"));
    }
    sqlx::query("UPDATE webknossos.tasktypes SET isdeleted=true,summary=summary || '.deleted.at.' || floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text WHERE _id=$1 AND NOT isdeleted")
        .bind(&id).execute(&mut *tx).await?;
    crate::projects::delete_tasks(&mut tx, "_tasktype", &id).await?;
    tx.commit().await?;
    Ok(ResponseJson(
        json!({"messages":[{"success":"taskType.deleteSuccess"}]}),
    ))
}

async fn lock_task_type(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
    organization: &str,
) -> ApiResult<()> {
    sqlx::query_scalar::<_,String>("SELECT _id FROM webknossos.tasktypes WHERE _id=$1 AND _organization=$2 AND NOT isdeleted FOR UPDATE")
        .bind(id).bind(organization).fetch_optional(&mut **tx).await?
        .ok_or_else(||ApiError::not_found("taskType.notFound"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parameters() -> TaskTypeParameters {
        serde_json::from_value(json!({"summary":"task","description":"","teamId":"000000000000000000000001","tracingType":"skeleton","settings":{"allowedModes":["orthogonal","flight"]}})).unwrap()
    }
    #[test]
    fn summary_limits_match_scala_utf16_length() {
        let mut p = parameters();
        for summary in ["", "a", &"a".repeat(51)] {
            p.summary = summary.to_owned();
            assert!(validate(&p).is_err());
        }
        for summary in ["ab", &"a".repeat(50), "💡"] {
            p.summary = summary.to_owned();
            assert!(validate(&p).is_ok());
        }
    }
    #[test]
    fn settings_defaults_and_enum_validation() {
        let p = parameters();
        assert!(
            p.settings.branch_points_allowed
                && p.settings.soma_clicking_allowed
                && p.settings.volume_interpolation_allowed
        );
        assert!(!p.settings.merger_mode);
        assert_eq!(p.settings.mag_restrictions, MagRestrictions::default());
        assert!(serde_json::from_value::<TracingType>(json!("invalid")).is_err());
        assert!(serde_json::from_value::<TracingMode>(json!("volume")).is_err());
    }
    #[test]
    fn recommended_configuration_requires_object() {
        let mut p = parameters();
        p.recommended_configuration = Some(json!([]));
        assert!(validate(&p).is_err());
        p.recommended_configuration = Some(json!({"zoom":2}));
        assert!(validate(&p).is_ok());
    }
}
