-- https://github.com/scalableminds/webknossos/pull/4922

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.taskTypes ADD COLUMN settings_resolutionRestrictions_min INT DEFAULT NULL;
ALTER TABLE webknossos.taskTypes ADD COLUMN settings_resolutionRestrictions_max INT DEFAULT NULL;

update webknossos.taskTypes
set settings_resolutionRestrictions_min = (settings_allowedmagnifications->>'min')::int
where (settings_allowedmagnifications->>'shouldRestrict') = 'true';

update webknossos.taskTypes
set settings_resolutionRestrictions_max = (settings_allowedmagnifications->>'max')::int
where (settings_allowedmagnifications->>'shouldRestrict') = 'true';

ALTER TABLE webknossos.taskTypes DROP CONSTRAINT settings_allowedMagnificationsIsJsonObject;
ALTER TABLE webknossos.taskTypes DROP COLUMN settings_allowedMagnifications;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 59;

COMMIT TRANSACTION;
