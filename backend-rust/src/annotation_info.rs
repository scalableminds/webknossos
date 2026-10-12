//! AnnotationController.info (`GET /annotations/:typ/:id/info`) and
//! infoWithoutType (`GET /annotations/:id/info`): UserAwareAction reads of
//! saved and compound annotations, serialized like AnnotationService.publicWrites,
//! with the "user starts working" time-tracking interaction.
//!
//! Neither route takes a sharing token: Play's UserAwareAction builds
//! `DBAccessContext(request.identity)`, so anonymous requesters can only read
//! Public saved annotations (AnnotationDAO.anonymousReadAccessQ). A
//! `sharingToken` query parameter is ignored like any unknown parameter.
use axum::{
    Extension, Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    routing::get,
};
use serde_json::{Map, Value, json};
use sqlx::PgConnection;

use crate::{
    AppState,
    annotation_access::Restrictions,
    annotation_lists,
    annotation_metadata::{NOT_ALLOWED, PUBLIC_WRITES_FAILED},
    annotation_provider::{
        ANNOTATION_NOT_FOUND, AccessContext, AnnotationIdentifier, AnnotationLayerType,
        AnnotationProvider, AnnotationType, CompoundAnnotation, ProvidedAnnotation,
        RESTRICTIONS_NOT_FOUND,
    },
    application_info::MiscState,
    auth::{AuthUser, OptionalAuthUser},
    error::{ApiError, ApiResult},
    extract::Path,
    id::ObjectId,
    time_interaction_writer::TimeInteractionWriter,
};

/// Msg.Annotation.notFoundConsiderLogin (anonymous requesters).
pub const NOT_FOUND_CONSIDER_LOGIN: &str =
    "Annotation could not be found or accessed. You may need to log in to see it.";
/// Msg.Annotation.cancelled.
pub const ANNOTATION_CANCELLED: &str =
    "This annotation is marked as cancelled and cannot be viewed.";

/// Msg.Annotation.invalidType(typ).
pub fn invalid_type(typ: &str) -> String {
    format!("The supplied annotation type “{typ}” is not a valid annotation type.")
}

#[derive(Clone, Copy)]
struct JobsEnabled(bool);

pub fn router(jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{typ}/{id}/info", get(info))
        .route("/annotations/{id}/info", get(info_without_type))
        .layer(Extension(JobsEnabled(jobs_enabled)))
}

/// Play's `timestamp: Option[Long]` query binder: absent is `None`, present
/// values use the Long binder (first value wins). Bound during routing, so
/// it is extracted before authentication.
pub struct OptionalTimestamp(pub Option<i64>);

pub fn parse_optional_timestamp(query: Option<&str>) -> ApiResult<Option<i64>> {
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query.unwrap_or(""))
        .map_err(|_| ApiError::bad_request("Invalid query parameters."))?;
    if !pairs.iter().any(|(key, _)| key == "timestamp") {
        return Ok(None);
    }
    crate::annotation_finish::parse_timestamp(query).map(Some)
}

impl<S: Send + Sync> FromRequestParts<S> for OptionalTimestamp {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parse_optional_timestamp(parts.uri.query()).map(Self)
    }
}

/// Router-wide extensions used by both handlers (no side effects).
struct Services {
    provider: AnnotationProvider,
    writer: TimeInteractionWriter,
    misc: MiscState,
    jobs_enabled: bool,
}

fn extension<T: Clone + Send + Sync + 'static>(parts: &Parts) -> ApiResult<T> {
    parts
        .extensions
        .get::<T>()
        .cloned()
        .ok_or_else(ApiError::internal)
}

impl<S: Send + Sync> FromRequestParts<S> for Services {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self {
            provider: extension(parts)?,
            writer: extension(parts)?,
            misc: extension(parts)?,
            jobs_enabled: extension::<JobsEnabled>(parts)?.0,
        })
    }
}

struct InfoContext<'a> {
    state: &'a AppState,
    services: &'a Services,
    user: Option<&'a AuthUser>,
}

/// GET /annotations/:typ/:id/info?timestamp=
async fn info(
    State(state): State<AppState>,
    services: Services,
    OptionalTimestamp(timestamp): OptionalTimestamp,
    Path((typ, id)): Path<(String, String)>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let context = InfoContext {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    info_for(&context, &typ, &id, timestamp).await.map(Json)
}

/// GET /annotations/:id/info?timestamp=: provideAnnotation(id, userOpt) looks
/// up the saved row (Explorational if it has no task, else Task identifier;
/// never compound) with a plain 404 Msg.Annotation.notFound (no login hint),
/// then runs `info` with the STORED type, re-providing the annotation.
async fn info_without_type(
    State(state): State<AppState>,
    services: Services,
    OptionalTimestamp(timestamp): OptionalTimestamp,
    Path(id): Path<String>,
    OptionalAuthUser(user): OptionalAuthUser,
) -> ApiResult<Json<Value>> {
    let id = ObjectId::parse_path(&id)?;
    let saved = services
        .provider
        .provide_saved(AccessContext::requester(user.as_ref()), &id)
        .await
        .map_err(|error| error.into_api_error(StatusCode::NOT_FOUND))?;
    let context = InfoContext {
        state: &state,
        services: &services,
        user: user.as_ref(),
    };
    info_for(&context, &saved.annotation_type, &id, timestamp)
        .await
        .map(Json)
}

fn restrictions_json(restrictions: &Restrictions) -> Value {
    json!({
        "allowAccess": restrictions.allow_access,
        "allowUpdate": restrictions.allow_update,
        "allowFinish": restrictions.allow_finish,
        "allowDownload": restrictions.allow_download,
    })
}

/// AnnotationController.info, in Scala order.
async fn info_for(
    context: &InfoContext<'_>,
    typ: &str,
    id: &ObjectId,
    timestamp: Option<i64>,
) -> ApiResult<Value> {
    let user = context.user;
    let access = AccessContext::requester(user);
    let not_found = if user.is_none() {
        NOT_FOUND_CONSIDER_LOGIN
    } else {
        ANNOTATION_NOT_FOUND
    };
    // provideAnnotation ?~> notFoundMessage ~> NOT_FOUND (invalid types too).
    let annotation = context
        .services
        .provider
        .provide(access, typ, id)
        .await
        .map_err(|error| error.wrap(not_found).into_api_error(StatusCode::NOT_FOUND))?;
    if annotation
        .saved()
        .is_some_and(|saved| saved.state == "Cancelled")
    {
        return Err(ApiError::bad_request(ANNOTATION_CANCELLED));
    }
    let identifier =
        AnnotationIdentifier::parse(typ, id).map_err(|_| ApiError::not_found(invalid_type(typ)))?;
    let restrictions = context
        .services
        .provider
        .restrictions_for(access, &identifier)
        .await
        .map_err(|error| {
            error
                .wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND)
        })?;
    // Deliberately fail closed: in Scala `_ <- allowAccess(..) ?~> ~> FORBIDDEN`
    // binds a Fox[Boolean], so a `false` would not short-circuit. The message
    // and status show the intended gate; it only matters for compounds (saved
    // DAO read access is already at least as strict).
    if !restrictions.allow_access {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    let mut connection = context.state.pool.acquire().await?;
    let json = match &annotation {
        ProvidedAnnotation::Saved(saved) => {
            saved_json(
                &mut connection,
                user,
                &saved.id,
                context.services.jobs_enabled,
            )
            .await
        }
        ProvidedAnnotation::Compound(compound) => {
            compound_json(&mut connection, compound, context.services.jobs_enabled).await
        }
    }
    .map(|mut json| {
        json["restrictions"] = restrictions_json(&restrictions);
        json
    })
    .map_err(|error| {
        if error.status.is_server_error() {
            error
        } else {
            ApiError::bad_request(PUBLIC_WRITES_FAILED)
        }
    })?;
    drop(connection);
    // The REQUESTED type gates time tracking (a View path never logs; the
    // untyped route passes the stored type). Compounds are never Task or
    // Explorational. A logging failure fails the request, after serialization.
    if let (Some(user), Some(timestamp), Some(saved)) = (user, timestamp, annotation.saved())
        && matches!(
            identifier.annotation_type,
            AnnotationType::Task | AnnotationType::Explorational
        )
    {
        context
            .services
            .writer
            .log_user_interaction_if_potential_contributor(
                &context.state.pool,
                AccessContext::requester(Some(user)),
                &ObjectId::parse(&user.id)?,
                &ObjectId::parse(&saved.id)?,
                &ObjectId::parse(&saved.owner_id)?,
                &saved.collaboration_mode,
                timestamp,
            )
            .await?;
    }
    if let Some(user) = user {
        // Scala: `_ = updateLastActivity` and analytics, both not awaited.
        touch_last_activity(context.state, user);
        track_open_annotation(
            context.state,
            &context.services.misc,
            user,
            annotation.id().to_owned(),
            annotation.owner_id().to_owned(),
            annotation.dataset_id().to_owned(),
        );
    }
    Ok(json)
}

/// AnnotationService.publicWrites for a saved annotation via the shared
/// database serializer with the actual optional requester.
async fn saved_json(
    connection: &mut PgConnection,
    user: Option<&AuthUser>,
    id: &str,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    annotation_lists::full_json_for(connection, user, id, jobs_enabled).await
}

/// AnnotationService.publicWrites for the synthetic compound annotation
/// (never persisted): dataset/organization/datastore/tracing store read
/// globally, owner = first requester, no task, default settings. Shared
/// teams, contributors and view configurations reference
/// `annotations(_id)` by foreign key, so they are always empty/null for the
/// task/project/task-type ID of a compound.
async fn compound_json(
    connection: &mut PgConnection,
    compound: &CompoundAnnotation,
    jobs_enabled: bool,
) -> ApiResult<Value> {
    let dataset_id = compound.dataset_id.as_str();
    let (dataset_name, organization, datastore): (String, String, String) = sqlx::query_as(
        "SELECT d.name,o._id,trim(d._dataStore) FROM webknossos.datasets_ d
         JOIN webknossos.organizations_ o ON o._id=d._organization WHERE d._id=$1",
    )
    .bind(dataset_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::not_found("Annotation dataset not found."))?;
    let owner = annotation_lists::compact_user(connection, compound.owner_id.as_str()).await?;
    let data_store =
        crate::datasets::public_datastore_json_on_connection(connection, &datastore, jobs_enabled)
            .await?;
    let tracing_store: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('name',store.name,'url',store.publicUrl) FROM webknossos.tracingStores_ store LIMIT 1",
    )
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| ApiError::not_found("Tracing store not found."))?;
    let layers: Vec<Value> = compound
        .layers
        .iter()
        .map(|layer| {
            json!({
                "tracingId": layer.tracing_id,
                "typ": match layer.typ {
                    AnnotationLayerType::Skeleton => "Skeleton",
                    AnnotationLayerType::Volume => "Volume",
                },
                "name": layer.name,
                "stats": {},
            })
        })
        .collect();
    let skeleton = compound
        .layers
        .iter()
        .any(|layer| layer.typ == AnnotationLayerType::Skeleton);
    let timestamp = compound.created.timestamp_millis();
    Ok(json!({
        "modified": timestamp,
        "created": timestamp,
        "state": "Active",
        "isLockedByOwner": false,
        "id": compound.id.as_str(),
        "name": "",
        "description": "",
        "viewConfiguration": Value::Null,
        "typ": compound.annotation_type.as_str(),
        "task": Value::Null,
        "stats": {},
        "restrictions": Value::Null,
        "annotationLayers": layers,
        "datasetId": dataset_id,
        "dataSetName": dataset_name,
        "organization": organization,
        "dataStore": data_store,
        "tracingStore": tracing_store,
        "visibility": "Internal",
        "settings": annotation_lists::default_settings(skeleton),
        "tracingTime": Value::Null,
        "teams": [],
        "tags": [dataset_name],
        "user": owner,
        "owner": owner,
        "contributors": [],
        "collaborationMode": "OwnerOnly",
    }))
}

/// UserDAO.updateLastActivity, fire-and-forget like Scala's `_ =`.
fn touch_last_activity(state: &AppState, user: &AuthUser) {
    let (pool, user_id) = (state.pool.clone(), user.id.clone());
    tokio::spawn(async move {
        if let Err(error) =
            sqlx::query("UPDATE webknossos.users SET lastActivity=now() WHERE _id=$1")
                .bind(&user_id)
                .execute(&pool)
                .await
        {
            tracing::debug!(%error, "Could not update last activity");
        }
    });
}

/// AnalyticsService.track(OpenAnnotationEvent): properties need the owner's
/// multiUser (global UserDAO lookup); a failed lookup drops the event.
fn track_open_annotation(
    state: &AppState,
    misc: &MiscState,
    user: &AuthUser,
    annotation_id: String,
    owner_id: String,
    dataset_id: String,
) {
    let (state, misc, user) = (state.clone(), misc.clone(), user.clone());
    tokio::spawn(async move {
        let owner_multi_user: Option<String> =
            match sqlx::query_scalar("SELECT _multiUser FROM webknossos.users_ WHERE _id=$1")
                .bind(&owner_id)
                .fetch_optional(&state.pool)
                .await
            {
                Ok(found) => found,
                Err(error) => {
                    tracing::debug!(%error, "Analytics owner lookup failed");
                    None
                }
            };
        let Some(owner_multi_user) = owner_multi_user else {
            return;
        };
        let mut properties = Map::new();
        properties.insert("annotation_id".into(), annotation_id.into());
        properties.insert(
            "annotation_owner_multiuser_id".into(),
            owner_multi_user.into(),
        );
        properties.insert("annotation_dataset_id".into(), dataset_id.into());
        crate::analytics::track(&state, &misc, &user, "open_annotation".into(), properties);
    });
}

#[cfg(test)]
mod tests {
    use super::parse_optional_timestamp;

    #[test]
    fn optional_timestamp_follows_play_option_long_binder() {
        assert_eq!(parse_optional_timestamp(None).unwrap(), None);
        assert_eq!(
            parse_optional_timestamp(Some("sharingToken=x")).unwrap(),
            None
        );
        assert_eq!(
            parse_optional_timestamp(Some("timestamp=5&timestamp=7")).unwrap(),
            Some(5)
        );
        assert_eq!(
            parse_optional_timestamp(Some("timestamp=abc"))
                .unwrap_err()
                .message,
            "Cannot parse parameter timestamp as Long: For input string: \"abc\""
        );
    }
}
