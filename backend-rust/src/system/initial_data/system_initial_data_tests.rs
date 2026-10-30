use super::*;

#[test]
fn sample_data_sources_parse() {
    for dataset in sample_datasets() {
        let source = UsableDataSource::from_json(&dataset.source).unwrap();
        assert_eq!(source.id.organization_id, SAMPLE_ORGANIZATION_ID);
        assert!(source.data_layers.len() >= 2);
    }
}

#[test]
fn publication_assignment() {
    let publication_of = |directory: &str| {
        sample_datasets()
            .into_iter()
            .find(|dataset| dataset.source["id"]["name"] == directory)
            .unwrap()
            .publication
    };
    assert_eq!(publication_of("l4_sample_remote"), None);
    assert_eq!(
        publication_of("l4dense_motta_et_al_demo"),
        Some(DEFAULT_PUBLICATION_ID)
    );
    for directory in [
        "l4_sample_remote_2",
        "l4_sample_remote_3",
        "l4_sample_remote_4",
        "l4_sample_remote_5",
    ] {
        assert_eq!(publication_of(directory), Some(DUMMY_PUBLICATION_ID));
    }
}

#[test]
fn l4_dense_layers_and_attachments() {
    let dataset = sample_datasets()
        .into_iter()
        .find(|dataset| dataset.id == L4_DENSE_DATASET_ID)
        .unwrap();
    assert_eq!(dataset.name, "L4 Dense Connectome (Motta et al. 2019)");
    assert!(
        dataset
            .description
            .unwrap()
            .starts_with("Dense connectomic")
    );
    let source = UsableDataSource::from_json(&dataset.source).unwrap();
    let names: Vec<_> = source.data_layers.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, ["color", "predictions", "segmentation"]);
    for layer in &source.data_layers {
        assert_eq!(layer.mags.len(), 11);
    }
    let layers = &dataset.source["dataLayers"];
    let mags = &layers[2]["mags"];
    assert!(
        mags[0]["path"]
            .as_str()
            .unwrap()
            .ends_with("/segmentation/1")
    );
    assert_eq!(mags[10]["mag"], json!([1024, 1024, 512]));
    assert!(
        mags[10]["path"]
            .as_str()
            .unwrap()
            .ends_with("/1024-1024-512")
    );
    let attachments = &layers[2]["attachments"];
    assert_eq!(attachments["agglomerates"].as_array().unwrap().len(), 20);
    assert_eq!(
        attachments["agglomerates"][19]["name"],
        "agglomerate_view_100"
    );
    assert_eq!(
        attachments["meshes"][0]["path"],
        "https://static.webknossos.org/data/l4dense_motta_et_al_demo/segmentation/meshes/meshfile_4-4-2"
    );
}

#[test]
fn default_worker_commands_are_known_job_commands() {
    for command in DEFAULT_WORKER_COMMANDS {
        assert!(crate::job::routes::is_job_command(command), "{command}");
    }
    assert_eq!(DEFAULT_WORKER_ID.len(), 24);
}
