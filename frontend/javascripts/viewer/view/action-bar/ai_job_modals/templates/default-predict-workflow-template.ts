export default `predict:
  task: PredictTask
  distribution:
    step:
      strategy: sequential
      num_io_threads: 5
  inputs:
    model: TO_BE_SET_BY_WORKER
  config:
    name: predict
    datasource_config:
      name: TO_BE_SET_BY_WORKER
      type: "wkw"
      scale: TO_BE_SET_BY_WORKER
      data_dir: "/"
      path: TO_BE_SET_BY_WORKER
      color_name: TO_BE_SET_BY_WORKER
      wkw_resolution: TO_BE_SET_BY_WORKER
      bounding_box:
        topleft: TO_BE_SET_BY_WORKER
        size: TO_BE_SET_BY_WORKER
    # your additional config keys here

# your additional tasks here

publish_dataset_meshes:
  task: PublishDatasetTask
  inputs:
    dataset: # your dataset here
  config:
    name: TO_BE_SET_BY_WORKER
    public_directory: TO_BE_SET_BY_WORKER
    datastore_url: TO_BE_SET_BY_WORKER
    use_symlinks: False
    move_dataset_symlink_artifact: True
    keep_symlinks_to: TO_BE_SET_BY_WORKER`;
