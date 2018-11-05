-- https://github.com/scalableminds/webknossos/pull/3415

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes ADD COLUMN recommendedConfiguration JSONB;


CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 33;

COMMIT TRANSACTION;
