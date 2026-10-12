//! Reserved annotation element IDs (`AnnotationController.reservedIds` and
//! `reserveIds`, `AnnotationReservedIdsService`). Scala serializes all
//! reservation work per annotation with an in-process semaphore; here a
//! transaction-scoped advisory lock shared with the collaboration-mode change
//! (`annotation_lifecycle`) serializes across application instances.
use axum::{
    Extension, Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::{Postgres, Transaction};

use crate::{
    AppState, annotation_access,
    annotation_metadata::NOT_ALLOWED,
    annotation_provider::{
        AccessContext, AnnotationIdentifier, AnnotationProvider, ProviderError, RESOURCE_NOT_FOUND,
        RESTRICTIONS_NOT_FOUND,
    },
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::{Json as JsonBody, Path, Query},
    id::ObjectId,
    service_clients::ServiceClients,
    tracingstore_client::first_tracing_store_url,
};

/// `AnnotationController.numberOfIdsToReservePerRequest` (hard-coded in
/// Scala, must match the frontend's IDEAL_ID_BUFFER_SIZE).
pub const NUMBER_OF_IDS_TO_RESERVE_PER_REQUEST: i32 = 10;

/// Msg.Annotation.reserveTooManyIds.
pub fn reserve_too_many_ids(limit: i32) -> String {
    format!("Cannot reserve more than {limit} ids in one request.")
}

/// Reservation range would exceed the 64-bit ID space (Scala overflows).
pub const ID_RANGE_OVERFLOW: &str = "Cannot reserve ids beyond the largest supported id.";

/// `AnnotationIdDomain` (ExtendedEnumeration, exact case-sensitive names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum AnnotationIdDomain {
    Segment,
    SegmentGroup,
    Tree,
    Node,
    TreeGroup,
    BoundingBox,
}

impl AnnotationIdDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Segment => "Segment",
            Self::SegmentGroup => "SegmentGroup",
            Self::Tree => "Tree",
            Self::Node => "Node",
            Self::TreeGroup => "TreeGroup",
            Self::BoundingBox => "BoundingBox",
        }
    }

    /// ExtendedEnumeration.fromString.
    pub fn from_name(name: &str) -> Option<Self> {
        [
            Self::Segment,
            Self::SegmentGroup,
            Self::Tree,
            Self::Node,
            Self::TreeGroup,
            Self::BoundingBox,
        ]
        .into_iter()
        .find(|domain| domain.as_str() == name)
    }
}

pub fn router(_jobs_enabled: bool) -> Router<AppState> {
    Router::new()
        .route("/annotations/{id}/reservedIds", get(reserved_ids))
        .route("/annotations/{id}/reserveIds", post(reserve_ids))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReservedIdsQuery {
    tracing_id: Option<String>,
    domain: Option<String>,
}

/// `ReserveIdParameters` (Play JsonAutoFormat: all fields required).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReserveIdParameters {
    domain: AnnotationIdDomain,
    tracing_id: String,
    number_of_ids_to_reserve: i32,
    ids_to_release: Vec<i64>,
}

enum Permission {
    Access,
    Update,
}

/// provideAnnotation(id, user) ~> 404, restrictionsFor(typ, id) ~> 404, then
/// allowAccess/allowUpdate ~> 403 Msg.notAllowed.
async fn authorize(
    provider: &AnnotationProvider,
    user: &AuthUser,
    id: &ObjectId,
    permission: Permission,
) -> ApiResult<()> {
    let context = AccessContext::requester(Some(user));
    let annotation = provider
        .provide_saved(context, id)
        .await
        .map_err(|e| e.into_api_error(StatusCode::NOT_FOUND))?;
    let identifier = AnnotationIdentifier::parse(&annotation.annotation_type, id).map_err(|e| {
        e.wrap(RESTRICTIONS_NOT_FOUND)
            .into_api_error(StatusCode::NOT_FOUND)
    })?;
    let restrictions = provider
        .restrictions_for(context, &identifier)
        .await
        .map_err(|e| {
            e.wrap(RESTRICTIONS_NOT_FOUND)
                .into_api_error(StatusCode::NOT_FOUND)
        })?;
    let allowed = match permission {
        Permission::Access => restrictions.allow_access,
        Permission::Update => restrictions.allow_update,
    };
    if !allowed {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    Ok(())
}

/// Transaction advisory key shared with the collaboration-mode change, which
/// deletes all reservations when leaving Concurrent mode.
async fn lock_reservations(
    transaction: &mut Transaction<'_, Postgres>,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("annotation-reservations:{id}"))
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn reserved_ids(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    user: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ReservedIdsQuery>,
) -> ApiResult<Json<Vec<i64>>> {
    let tracing_id = query
        .tracing_id
        .ok_or_else(|| ApiError::bad_request("Missing parameter: tracingId"))?;
    let domain = query
        .domain
        .ok_or_else(|| ApiError::bad_request("Missing parameter: domain"))?;
    let id = ObjectId::parse_path(&id)?;
    authorize(&provider, &user, &id, Permission::Access).await?;
    // AnnotationIdDomain.fromString(domain).toFox: Empty -> 404 Msg.notFound.
    let domain = AnnotationIdDomain::from_name(&domain)
        .ok_or_else(|| ApiError::not_found(RESOURCE_NOT_FOUND))?;
    let mut transaction = state.pool.begin().await?;
    lock_reservations(&mut transaction, &id).await?;
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM webknossos.annotation_reserved_ids
         WHERE _annotation=$1 AND tracingId=$2 AND _user=$3
           AND domain=$4::webknossos.ANNOTATION_ID_DOMAIN
         ORDER BY id",
    )
    .bind(id.as_str())
    .bind(&tracing_id)
    .bind(&user.id)
    .bind(domain.as_str())
    .fetch_all(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(ids))
}

async fn reserve_ids(
    State(state): State<AppState>,
    Extension(provider): Extension<AnnotationProvider>,
    Extension(clients): Extension<ServiceClients>,
    user: AuthUser,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<ReserveIdParameters>,
) -> ApiResult<Json<Vec<i64>>> {
    let id = ObjectId::parse_path(&id)?;
    authorize(&provider, &user, &id, Permission::Update).await?;
    if body.number_of_ids_to_reserve > NUMBER_OF_IDS_TO_RESERVE_PER_REQUEST {
        return Err(ApiError::forbidden(reserve_too_many_ids(
            NUMBER_OF_IDS_TO_RESERVE_PER_REQUEST,
        )));
    }
    let domain = body.domain.as_str();
    let mut transaction = state.pool.begin().await?;
    lock_reservations(&mut transaction, &id).await?;
    // Re-check under the shared key: a concurrent switch away from Concurrent
    // mode (which deletes all reservations) must not be followed by stale
    // reservations authorized against the old mode.
    let live = annotation_access::find_optional(&mut *transaction, Some(&user), id.as_str(), false)
        .await?
        .ok_or_else(|| ProviderError::NotFound.into_api_error(StatusCode::NOT_FOUND))?;
    if !annotation_access::restrictions(&live, Some(&user)).allow_update {
        return Err(ApiError::forbidden(NOT_ALLOWED));
    }
    let largest_reserved: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(id) FROM webknossos.annotation_reserved_ids
         WHERE _annotation=$1 AND tracingId=$2 AND domain=$3::webknossos.ANNOTATION_ID_DOMAIN",
    )
    .bind(id.as_str())
    .bind(&body.tracing_id)
    .bind(domain)
    .fetch_one(&mut *transaction)
    .await?;
    let largest_existing = match largest_reserved {
        Some(largest) => largest,
        None => {
            let tracing_store = first_tracing_store_url(&mut *transaction).await?;
            largest_id_or_zero(&clients, &tracing_store, &id, &body.tracing_id, domain).await?
        }
    };
    let count = i64::from(body.number_of_ids_to_reserve.max(0));
    let first = largest_existing
        .checked_add(1)
        .ok_or_else(|| ApiError::bad_request(ID_RANGE_OVERFLOW))?;
    let end = first
        .checked_add(count)
        .ok_or_else(|| ApiError::bad_request(ID_RANGE_OVERFLOW))?;
    let reserved: Vec<i64> = (first..end).collect();
    if !reserved.is_empty() {
        sqlx::query(
            "INSERT INTO webknossos.annotation_reserved_ids(_annotation,tracingId,domain,_user,id)
             SELECT $1,$2,$3::webknossos.ANNOTATION_ID_DOMAIN,$4,UNNEST($5::bigint[])",
        )
        .bind(id.as_str())
        .bind(&body.tracing_id)
        .bind(domain)
        .bind(&user.id)
        .bind(&reserved)
        .execute(&mut *transaction)
        .await?;
    }
    if !body.ids_to_release.is_empty() {
        sqlx::query(
            "DELETE FROM webknossos.annotation_reserved_ids
             WHERE _annotation=$1 AND tracingId=$2 AND domain=$3::webknossos.ANNOTATION_ID_DOMAIN
               AND _user=$4 AND id=ANY($5::bigint[])",
        )
        .bind(id.as_str())
        .bind(&body.tracing_id)
        .bind(domain)
        .bind(&user.id)
        .bind(&body.ids_to_release)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(Json(reserved))
}

/// WKRemoteTracingStoreClient.getLargestIdOfDomainOrZero:
/// `GET /tracings/annotation/:id/largestIdOrZero?tracingId=&domain=&token=`
/// returning a JSON number. Upstream failures keep the shared RPC mapping.
pub async fn largest_id_or_zero(
    clients: &ServiceClients,
    tracing_store_url: &str,
    annotation_id: &ObjectId,
    tracing_id: &str,
    domain: &str,
) -> ApiResult<i64> {
    Ok(clients
        .get_json(
            tracing_store_url,
            &[
                "tracings",
                "annotation",
                annotation_id.as_str(),
                "largestIdOrZero",
            ],
            &[
                ("tracingId", tracing_id.to_owned()),
                ("domain", domain.to_owned()),
            ],
        )
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_names_are_exact_and_case_sensitive() {
        for name in [
            "Segment",
            "SegmentGroup",
            "Tree",
            "Node",
            "TreeGroup",
            "BoundingBox",
        ] {
            assert_eq!(AnnotationIdDomain::from_name(name).unwrap().as_str(), name);
        }
        assert_eq!(AnnotationIdDomain::from_name("segment"), None);
        assert_eq!(AnnotationIdDomain::from_name(""), None);
        assert_eq!(
            reserve_too_many_ids(10),
            "Cannot reserve more than 10 ids in one request."
        );
    }
}
