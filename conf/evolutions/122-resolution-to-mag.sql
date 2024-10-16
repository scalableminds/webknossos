START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 121, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.dataset_resolutions RENAME TO dataset_mags;
ALTER TABLE webknossos.dataset_mags RENAME COLUMN resolution to mag;
ALTER TABLE webknossos.dataset_mags DROP CONSTRAINT dataset_resolutions_pkey;
ALTER TABLE webknossos.dataset_mags ADD CONSTRAINT dataset_mags_pkey PRIMARY KEY (_dataset, dataLayerName, mag);

ALTER TABLE webknossos.taskTypes RENAME COLUMN settings_resolutionRestrictions_min TO settings_magRestrictions_min;
ALTER TABLE webknossos.taskTypes RENAME COLUMN settings_resolutionRestrictions_max TO settings_magRestrictions_max;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 122;

COMMIT TRANSACTION;
