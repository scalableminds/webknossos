-- Note: Not all fields of celeryInfo are recreated. The celeryJobId is cropped to 36 chars (should still be unique, though)

START TRANSACTION;

DROP VIEW webknossos.jobs_;
DROP VIEW webknossos.workers_;
DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.jobs DROP CONSTRAINT dataStore_ref;
ALTER TABLE webknossos.jobs DROP CONSTRAINT worker_ref;

CREATE TYPE webknossos.JOB_MANUAL_STATE AS ENUM ('SUCCESS', 'FAILURE');

ALTER TABLE webknossos.jobs ADD COLUMN celeryJobId CHAR(36);
ALTER TABLE webknossos.jobs ADD COLUMN celeryInfo JSONB;
ALTER TABLE webknossos.jobs ADD COLUMN manualState_NEW webknossos.JOB_MANUAL_STATE;

ALTER TABLE webknossos.dataStores ADD COLUMN jobsEnabled BOOLEAN NOT NULL DEFAULT false;

-- values

update webknossos.dataStores set jobsEnabled = true where name in
    (select _dataStore from webknossos.workers where isDeleted = false);

update webknossos.jobs set manualState_NEW = manualState::text::webknossos.JOB_MANUAL_STATE;

update webknossos.jobs set celeryJobId = substring(latestRunId from 0 for 36);


update webknossos.jobs
set celeryInfo = jsonb_build_object(
    'state', state,
    'kwargs', commandArgs,
    'result', returnValue
);

update webknossos.jobs
set commandArgs = jsonb_build_object('kwargs', commandArgs);

-- values end

alter table webknossos.jobs alter column celeryJobId SET NOT NULL;
alter table webknossos.jobs alter column celeryInfo SET NOT NULL;

DROP TABLE webknossos.workers;


ALTER TABLE webknossos.jobs DROP COLUMN _dataStore;
ALTER TABLE webknossos.jobs DROP COLUMN state;
ALTER TABLE webknossos.jobs DROP COLUMN _worker;
ALTER TABLE webknossos.jobs DROP COLUMN latestRunId;
ALTER TABLE webknossos.jobs DROP COLUMN returnValue;
ALTER TABLE webknossos.jobs DROP COLUMN started;
ALTER TABLE webknossos.jobs DROP COLUMN ended;



ALTER TABLE webknossos.jobs DROP COLUMN manualState;
ALTER TABLE webknossos.jobs RENAME COLUMN manualState_NEW TO manualState;



DROP TYPE webknossos.JOB_STATE;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 76;

COMMIT TRANSACTION;
