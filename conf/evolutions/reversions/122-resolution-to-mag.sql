START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 122, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.dataset_mags RENAME TO dataset_resolutions;
ALTER TABLE webknossos.dataset_resolutions RENAME COLUMN resolution to mag;
ALTER TABLE webknossos.dataset_resolutions DROP CONSTRAINT dataset_mags_pkey;
ALTER TABLE webknossos.dataset_resolutions ADD CONSTRAINT dataset_resolutions_pkey PRIMARY KEY (_dataset, dataLayerName, resolution);

ALTER TABLE webknossos.taskTypes RENAME COLUMN settings_magRestrictions_min TO settings_resolutionRestrictions_min;
ALTER TABLE webknossos.taskTypes RENAME COLUMN settings_magRestrictions_max TO settings_resolutionRestrictions_max;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 121;

COMMIT TRANSACTION;
