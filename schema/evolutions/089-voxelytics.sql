START TRANSACTION;

CREATE TYPE webknossos.VOXELYTICS_RUN_STATE AS ENUM ('PENDING', 'SKIPPED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED', 'STALE');

CREATE TABLE webknossos.voxelytics_artifacts (
    _id CHAR(24) NOT NULL,
    _task CHAR(24) NOT NULL,
    name VARCHAR(512) NOT NULL,
    path TEXT NOT NULL,
    fileSize INT8 NOT NULL,
    inodeCount INT8 NOT NULL,
    version TEXT NOT NULL DEFAULT '0',
    metadata JSONB,
    PRIMARY KEY (_id),
    UNIQUE (_task, name),
    CONSTRAINT metadataIsJsonObject CHECK(jsonb_typeof(metadata) = 'object')
);

CREATE TABLE webknossos.voxelytics_runs (
    _id CHAR(24) NOT NULL,
    _organization CHAR(24) NOT NULL,
    _user CHAR(24) NOT NULL,
    name VARCHAR(2048) NOT NULL,
    username TEXT NOT NULL,
    hostname TEXT NOT NULL,
    voxelyticsVersion TEXT NOT NULL,
    workflow_hash VARCHAR(512) NOT NULL,
    workflow_yamlContent TEXT,
    workflow_config JSONB,
    PRIMARY KEY (_id),
    UNIQUE (_organization, name),
    CONSTRAINT workflowConfigIsJsonObject CHECK(jsonb_typeof(workflow_config) = 'object')
);

CREATE TABLE webknossos.voxelytics_tasks (
    _id CHAR(24) NOT NULL,
    _run CHAR(24) NOT NULL,
    name varCHAR(2048) NOT NULL,
    task varCHAR(512) NOT NULL,
    config JSONB NOT NULL,
    PRIMARY KEY (_id),
    UNIQUE (_run, name),
    CONSTRAINT configIsJsonObject CHECK(jsonb_typeof(config) = 'object')
);

CREATE TABLE webknossos.voxelytics_chunks (
    _id CHAR(24) NOT NULL,
    _task CHAR(24) NOT NULL,
    executionId VARCHAR(2048) NOT NULL,
    chunkName VARCHAR(2048) NOT NULL,
    PRIMARY KEY (_id),
    UNIQUE (_task, executionId, chunkName)
);

CREATE TABLE webknossos.voxelytics_workflows (
    _organization CHAR(24) NOT NULL,
    hash VARCHAR(512) NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (_organization, hash)
);

CREATE TABLE webknossos.voxelytics_runStateChangeEvents (
    _run CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    state webknossos.VOXELYTICS_RUN_STATE NOT NULL,
    PRIMARY KEY (_run, timestamp)
);

CREATE TABLE webknossos.voxelytics_runHeartbeatEvents (
    _run CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_run)
);

CREATE TABLE webknossos.voxelytics_taskStateChangeEvents (
    _task CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    state webknossos.VOXELYTICS_RUN_STATE NOT NULL,
    PRIMARY KEY (_task, timestamp)
);

CREATE TABLE webknossos.voxelytics_chunkStateChangeEvents (
    _chunk CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    state webknossos.VOXELYTICS_RUN_STATE NOT NULL,
    PRIMARY KEY (_chunk, timestamp)
);

CREATE TABLE webknossos.voxelytics_chunkProfilingEvents (
    _chunk CHAR(24) NOT NULL,
    hostname TEXT NOT NULL,
    pid INT8 NOT NULL,
    memory FLOAT NOT NULL,
    cpuUser FLOAT NOT NULL,
    cpuSystem FLOAT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_chunk, timestamp)
);

CREATE TABLE webknossos.voxelytics_artifactFileChecksumEvents (
    _artifact CHAR(24) NOT NULL,
    path TEXT NOT NULL,
    resolvedPath TEXT NOT NULL,
    checksumMethod VARCHAR(512) NOT NULL,
    checksum VARCHAR(512) NOT NULL,
    fileSize INT8 NOT NULL,
    lastModified TIMESTAMPTZ NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_artifact, path, timestamp)
);

ALTER TABLE webknossos.voxelytics_artifacts
  ADD FOREIGN KEY (_task) REFERENCES webknossos.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runs
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_organization, workflow_hash) REFERENCES webknossos.voxelytics_workflows(_organization, hash) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_tasks
  ADD FOREIGN KEY (_run) REFERENCES webknossos.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_chunks
  ADD FOREIGN KEY (_task) REFERENCES webknossos.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_workflows
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runStateChangeEvents
  ADD FOREIGN KEY (_run) REFERENCES webknossos.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runHeartbeatEvents
  ADD FOREIGN KEY (_run) REFERENCES webknossos.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_taskStateChangeEvents
  ADD FOREIGN KEY (_task) REFERENCES webknossos.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_chunkStateChangeEvents
  ADD FOREIGN KEY (_chunk) REFERENCES webknossos.voxelytics_chunks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_chunkProfilingEvents
  ADD FOREIGN KEY (_chunk) REFERENCES webknossos.voxelytics_chunks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents
  ADD FOREIGN KEY (_artifact) REFERENCES webknossos.voxelytics_artifacts(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 89;

COMMIT TRANSACTION;
