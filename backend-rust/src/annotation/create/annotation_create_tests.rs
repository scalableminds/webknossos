use super::*;
use crate::{annotation::tracing_initialization::TracingInitError, stores::client::ServiceError};

#[test]
fn zeroed_statistics_match_scala() {
    assert_eq!(
        zeroed_statistics(AnnotationLayerType::Skeleton),
        json!({"treeCount":0,"nodeCount":0,"edgeCount":0,"branchPointCount":0,"boundingBoxCount":0})
    );
    assert_eq!(
        zeroed_statistics(AnnotationLayerType::Volume),
        json!({"segmentCount":0,"boundingBoxCount":0})
    );
}

#[test]
fn empty_fallback_failure_wraps_to_create_failed() {
    let error = ProviderError::from(TracingInitError::FallbackLayerNotFound("x".into()))
        .wrap(CREATE_TRACINGS_FAILED)
        .wrap(CREATE_FAILED);
    assert_eq!(error.chain(), [CREATE_TRACINGS_FAILED]);
    let api = ApiError::from(error);
    assert_eq!(api.status, StatusCode::BAD_REQUEST);
    assert_eq!(api.message, CREATE_FAILED);
}

#[test]
fn upstream_status_is_kept_through_wrapping() {
    let error = ProviderError::from(ServiceError::UpstreamStatus(503))
        .wrap(CREATE_TRACINGS_FAILED)
        .wrap(CREATE_FAILED);
    let api = ApiError::from(error);
    assert_eq!(api.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(api.message, CREATE_FAILED);
}
