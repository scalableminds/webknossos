START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 110, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.workers_;

ALTER TABLE webknossos.workers ADD COLUMN maxParallelJobs INT NOT NULL DEFAULT 1,

UPDATE webknossos.workers set maxParallelJobs = maxParallelHighPriorityJobs;

ALTER TABLE webknossos.workers DROP COLUMN maxParallelHighPriorityJobs;
ALTER TABLE webknossos.workers DROP COLUMN maxParallelLowPriorityJobs;
ALTER TABLE webknossos.workers DROP COLUMN supportedJobCommands;

CREATE VIEW webknossos.workers_ as SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 109;

COMMIT TRANSACTION;
