use super::*;

#[test]
fn tracing_type_is_case_sensitive_and_skeleton_only() {
    assert!(require_skeleton("skeleton").is_ok());
    for typ in ["volume", "hybrid"] {
        let error = require_skeleton(typ).unwrap_err();
        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert_eq!(error.message, SANDBOX_SKELETON_ONLY);
    }
    for typ in ["Skeleton", "Explorational", ""] {
        let error = require_skeleton(typ).unwrap_err();
        assert_eq!(error.status, axum::http::StatusCode::NOT_FOUND);
        assert_eq!(error.message, RESOURCE_NOT_FOUND);
    }
}

#[test]
fn dummy_owner_yields_no_restrictions_even_for_admins() {
    let user = AuthUser {
        id: "5f0000000000000000000001".to_owned(),
        organization_id: "org".to_owned(),
        is_admin: true,
        is_dataset_manager: true,
        is_superuser: true,
    };
    let annotation = sandbox_metadata("5f0000000000000000000002", Utc::now());
    for user in [None, Some(&user)] {
        let r = crate::annotation::access::restrictions(&annotation, user);
        assert!(!r.allow_access && !r.allow_update && !r.allow_finish && !r.allow_download);
    }
}
