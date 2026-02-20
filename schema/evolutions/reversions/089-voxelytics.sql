START TRANSACTION;

DROP TABLE
  webknossos.voxelytics_artifacts,
  webknossos.voxelytics_runs,
  webknossos.voxelytics_tasks,
  webknossos.voxelytics_chunks,
  webknossos.voxelytics_workflows,
  webknossos.voxelytics_runStateChangeEvents,
  webknossos.voxelytics_runHeartbeatEvents,
  webknossos.voxelytics_taskStateChangeEvents,
  webknossos.voxelytics_chunkStateChangeEvents,
  webknossos.voxelytics_chunkProfilingEvents,
  webknossos.voxelytics_artifactFileChecksumEvents
  CASCADE;

DROP TYPE webknossos.VOXELYTICS_RUN_STATE;

UPDATE webknossos.releaseInformation SET schemaVersion = 88;

COMMIT TRANSACTION;
