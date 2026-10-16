use super::*;

#[test]
fn layer_types_match_schema_enum() {
    assert_eq!(layer_type(AnnotationLayerType::Skeleton), "Skeleton");
    assert_eq!(layer_type(AnnotationLayerType::Volume), "Volume");
}
