START TRANSACTION;

DROP TABLE
  webknossos.voxelytics_artifacts,
  webknossos.voxelytics_runs,
  webknossos.voxelytics_tasks,
  webknossos.voxelytics_chunks,
  webknossos.voxelytics_workflows,
  webknossos.voxelytics_run_state_change_events,
  webknossos.voxelytics_run_heartbeat_events,
  webknossos.voxelytics_task_state_change_events,
  webknossos.voxelytics_chunk_state_change_events,
  webknossos.voxelytics_chunk_profiling_events,
  webknossos.voxelytics_artifact_file_checksum_events
  CASCADE;

DROP TYPE webknossos.VOXELYTICS_RUN_STATE;

UPDATE webknossos.releaseInformation SET schemaVersion = 85;

COMMIT TRANSACTION;
