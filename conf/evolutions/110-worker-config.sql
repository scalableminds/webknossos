START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 109, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.workers_;

ALTER TABLE webknossos.workers ADD COLUMN maxParallelHighPriorityJobs INT NOT NULL DEFAULT 1;
ALTER TABLE webknossos.workers ADD COLUMN maxParallelLowPriorityJobs INT NOT NULL DEFAULT 1;
ALTER TABLE webknossos.workers ADD COLUMN supportedJobCommands VARCHAR(256)[] NOT NULL DEFAULT array[]::varchar(256)[];

UPDATE webknossos.workers set maxParallelHighPriorityJobs = maxParallelJobs;
UPDATE webknossos.workers set maxParallelLowPriorityJobs = maxParallelJobs;

ALTER TABLE webknossos.workers DROP COLUMN maxParallelJobs;

CREATE VIEW webknossos.workers_ as SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 110;

COMMIT TRANSACTION;
