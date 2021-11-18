START TRANSACTION;

DROP VIEW webknossos.jobs_;

CREATE TABLE webknossos.workers(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  _dataStore CHAR(256) NOT NULL,
  key VARCHAR(1024) NOT NULL,
  maxParallelJobs INT NOT NULL DEFAULT 1,
  lastHeartBeat TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01T00:00:00Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.JOB_STATE AS ENUM ('PENDING', 'STARTED', 'SUCCESS', 'FAILURE');

ALTER TABLE webknossos.jobs ADD COLUMN _dataStore CHAR(256) NOT NULL;
ALTER TABLE webknossos.jobs ADD COLUMN state webknossos.JOB_STATE NOT NULL DEFAULT 'PENDING';
ALTER TABLE webknossos.jobs ADD COLUMN manualState webknossos.JOB_STATE;
ALTER TABLE webknossos.jobs ADD COLUMN _worker CHAR(24);
ALTER TABLE webknossos.jobs ADD COLUMN latestRunId VARCAR(1024);
ALTER TABLE webknossos.jobs ADD COLUMN returnValue Text;
ALTER TABLE webknossos.jobs ADD COLUMN started TIMESTAMPTZ;
ALTER TABLE webknossos.jobs ADD COLUMN ended TIMESTAMPTZ;

-- values

ALTER TABLE webknossos.jobs DROP COLUMN manualState;
ALTER TABLE webknossos.jobs DROP COLUMN celeryInfo;
ALTER TABLE webknossos.jobs DROP COLUMN celeryJobId;

DROP TYPE webknossos.JOB_MANUAL_STATE AS ENUM ('SUCCESS', 'FAILURE');

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 77;

COMMIT TRANSACTION;
