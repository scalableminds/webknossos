use super::*;

#[test]
fn sample_data_sources_parse() {
    for dataset in sample_datasets() {
        let source = UsableDataSource::from_json(&dataset.source).unwrap();
        assert_eq!(source.id.organization_id, SAMPLE_ORGANIZATION_ID);
        assert_eq!(source.data_layers.len(), 2);
    }
}
