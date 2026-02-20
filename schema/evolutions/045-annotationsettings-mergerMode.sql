-- https://github.com/scalableminds/webknossos/pull/???

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes ADD COLUMN settings_mergerMode BOOLEAN NOT NULL DEFAULT false;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 45;

COMMIT TRANSACTION;
