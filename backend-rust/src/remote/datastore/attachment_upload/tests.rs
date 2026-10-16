use super::*;

#[test]
fn pending_placeholder_is_a_valid_upath_and_singletons_match_scala() {
    assert_eq!(
        crate::dataset::source::normalize_upath("<pending upload>").unwrap(),
        PENDING_UPLOAD_PATH
    );
    for (typ, singleton) in [
        (AttachmentType::Mesh, false),
        (AttachmentType::Agglomerate, false),
        (AttachmentType::Connectome, false),
        (AttachmentType::SegmentIndex, true),
        (AttachmentType::Cumsum, true),
        (AttachmentType::SegmentStatistics, true),
    ] {
        assert_eq!(is_singleton(typ), singleton, "{typ:?}");
    }
}
