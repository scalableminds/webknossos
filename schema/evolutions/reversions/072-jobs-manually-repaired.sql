START TRANSACTION;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs DROP COLUMN manualState;

DROP TYPE webknossos.JOB_MANUAL_STATE;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 71;

COMMIT TRANSACTION;
