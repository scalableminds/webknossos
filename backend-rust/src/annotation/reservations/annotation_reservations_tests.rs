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
        "Bookmark",
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

#[test]
fn only_bookmarks_use_an_empty_tracing_id() {
    assert!(assert_tracing_id_fits_domain("", AnnotationIdDomain::Bookmark).is_ok());
    assert!(assert_tracing_id_fits_domain("tracing", AnnotationIdDomain::Node).is_ok());
    assert!(assert_tracing_id_fits_domain("tracing", AnnotationIdDomain::Bookmark).is_err());
    assert!(assert_tracing_id_fits_domain("", AnnotationIdDomain::Segment).is_err());
    assert_eq!(
        reserved_ids_tracing_id_mismatch("Node"),
        "The tracingId must be empty for annotation-scoped id domains and set for all others \
         (domain Node)."
    );
}
