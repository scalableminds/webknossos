use super::*;

#[test]
fn sample_data_sources_parse() {
    for dataset in sample_datasets() {
        let source = crate::dataset::source::parse_data_source(&dataset.source).unwrap();
        assert_eq!(source.organization, SAMPLE_ORGANIZATION_ID);
        assert_eq!(source.layers.len(), 2);
    }
}
