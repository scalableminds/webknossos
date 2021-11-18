-- Note: If your setup contains a webknossos-worker, make sure to change the key below to a secure secret
-- This evolution assumes that at most one datastore has worker jobs enabled

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

ALTER TABLE webknossos.jobs ADD COLUMN _dataStore CHAR(256);
ALTER TABLE webknossos.jobs ADD COLUMN state webknossos.JOB_STATE DEFAULT 'PENDING';
ALTER TABLE webknossos.jobs ADD COLUMN manualState_NEW webknossos.JOB_STATE;
ALTER TABLE webknossos.jobs ADD COLUMN _worker CHAR(24);
ALTER TABLE webknossos.jobs ADD COLUMN latestRunId VARCHAR(1024);
ALTER TABLE webknossos.jobs ADD COLUMN returnValue TEXT;
ALTER TABLE webknossos.jobs ADD COLUMN started TIMESTAMPTZ;
ALTER TABLE webknossos.jobs ADD COLUMN ended TIMESTAMPTZ;

-- values

insert into webknossos.workers(_id, _dataStore, key)
select
    '6149aa5e01000089115af93d', d.name, 'temporaryWorkerKeyCHANGEME'
from
    webknossos.dataStores d where jobsEnabled;

update webknossos.jobs set _dataStore = d.name
   from webknossos.dataStores d where jobsEnabled;

update webknossos.jobs set manualState_NEW = manualState::text::webknossos.job_state;

update webknossos.jobs set _worker = '6149aa5e01000089115af93d';

update webknossos.jobs set latestRunId = celeryJobId;

update webknossos.jobs
set returnValue = (celeryInfo->>'result')::TEXT
where celeryInfo ? 'result' and celeryInfo ->> 'result' != 'None';

-- FAILURE should be the state of all that do not have a valid celery state. Differs from new default, hence this set.
update webknossos.jobs
set state = 'FAILURE';

update webknossos.jobs
set state = (celeryInfo->>'state')::TEXT::webknossos.job_state;
where celeryInfo ? 'state' and celeryInfo ->> 'state' != 'None';

-- values end

-- todo make _datastore + state not null
-- todo foreign keys


ALTER TABLE webknossos.jobs DROP COLUMN manualState;
ALTER TABLE webknossos.jobs RENAME COLUMN manualState_NEW TO manualState;
ALTER TABLE webknossos.jobs DROP COLUMN celeryInfo;
ALTER TABLE webknossos.jobs DROP COLUMN celeryJobId;

DROP TYPE webknossos.JOB_MANUAL_STATE;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 77;

COMMIT TRANSACTION;
