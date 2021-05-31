-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

DROP VIEW webknossos.jobs_;

CREATE TYPE webknossos.JOB_MANUAL_STATE AS ENUM ('SUCCESS', 'FAILURE');

ALTER TABLE webknossos.jobs ADD COLUMN manualState webknossos.JOB_MANUAL_STATE;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 72;

COMMIT TRANSACTION;
