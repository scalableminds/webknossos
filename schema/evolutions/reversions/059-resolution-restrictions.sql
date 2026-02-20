START TRANSACTION;

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.taskTypes ADD COLUMN settings_allowedMagnifications JSONB;

update webknossos.taskTypes
set settings_allowedMagnifications = jsonb_build_object(
  'min', settings_resolutionRestrictions_min,
  'max', settings_resolutionRestrictions_max,
  'shouldRestrict', 'true'
)
where settings_resolutionRestrictions_min is not null or settings_resolutionRestrictions_max is not null;

ALTER TABLE webknossos.taskTypes DROP COLUMN settings_resolutionRestrictions_max;
ALTER TABLE webknossos.taskTypes DROP COLUMN settings_resolutionRestrictions_min;

ALTER TABLE webknossos.taskTypes ADD CONSTRAINT settings_allowedMagnificationsIsJsonObject CHECK(jsonb_typeof(settings_allowedMagnifications) = 'object');

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 58;

COMMIT TRANSACTION;
