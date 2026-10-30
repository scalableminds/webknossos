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
