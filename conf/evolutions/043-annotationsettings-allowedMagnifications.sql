-- https://github.com/scalableminds/webknossos/pull/X

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes ADD COLUMN settings_allowedMagnifications JSONB;
ALTER TABLE webknossos.taskTypes
  ADD CONSTRAINT settings_allowedMagnificationsIsJsonObject CHECK (jsonb_typeof(settings_allowedMagnifications) = 'object');

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 43;

COMMIT TRANSACTION;
