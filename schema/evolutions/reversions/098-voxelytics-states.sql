START TRANSACTION;

ALTER TABLE webknossos.voxelytics_chunks
	DROP COLUMN beginTime,
	DROP COLUMN endTime,
	DROP COLUMN state;
ALTER TABLE webknossos.voxelytics_tasks
	DROP COLUMN beginTime,
	DROP COLUMN endTime,
	DROP COLUMN state;
ALTER TABLE webknossos.voxelytics_runs
	DROP COLUMN beginTime,
	DROP COLUMN endTime,
	DROP COLUMN state;


CREATE TABLE webknossos.voxelytics_runStateChangeEvents (
    _run CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    state webknossos.VOXELYTICS_RUN_STATE NOT NULL,
    PRIMARY KEY (_run, timestamp)
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

UPDATE webknossos.releaseInformation SET schemaVersion = 97;

COMMIT TRANSACTION;
