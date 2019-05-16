-- https://github.com/scalableminds/webknossos/pull/X

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes ADD COLUMN settings_allowedMagnifications JSONB;


CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 43;

COMMIT TRANSACTION;
