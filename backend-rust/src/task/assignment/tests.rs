use crate::annotation::provider::AnnotationLayerType;

#[test]
fn layer_types_match_schema_enum() {
    assert_eq!(AnnotationLayerType::Skeleton.as_str(), "Skeleton");
    assert_eq!(AnnotationLayerType::Volume.as_str(), "Volume");
}
