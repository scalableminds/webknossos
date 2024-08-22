export default `predict:
  task: PredictTask
  distribution:
    default:
      processes: 2
  inputs:
    model: TO_BE_SET_BY_WORKER
  config:
    name: predict
    datasource_config: TO_BE_SET_BY_WORKER
    # your additional config keys here

# your additional tasks here

publish_dataset_meshes:
  task: PublishDatasetTask
  inputs:
    dataset: # your dataset here
  config:
    name: TO_BE_SET_BY_WORKER
    public_directory: TO_BE_SET_BY_WORKER
    webknossos_organization: TO_BE_SET_BY_WORKER
    use_symlinks: False
    move_dataset_symlink_artifact: True`;
