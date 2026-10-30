use super::*;

#[test]
fn pending_placeholder_is_a_valid_upath_and_singletons_match_scala() {
    assert_eq!(
        UPath::parse("<pending upload>").unwrap().to_string(),
        PENDING_UPLOAD_PATH
    );
    for (typ, singleton) in [
        (LayerAttachmentType::Mesh, false),
        (LayerAttachmentType::Agglomerate, false),
        (LayerAttachmentType::Connectome, false),
        (LayerAttachmentType::SegmentIndex, true),
        (LayerAttachmentType::Cumsum, true),
        (LayerAttachmentType::SegmentStatistics, true),
    ] {
        assert_eq!(typ.is_singleton(), singleton, "{typ:?}");
    }
}
