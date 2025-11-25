START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 117, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.datasets_;

ALTER TABLE webknossos.datasets RENAME COLUMN voxelSizeFactor TO scale;
ALTER TABLE webknossos.datasets DROP COLUMN voxelSizeUnit;

DROP TYPE webknossos.LENGTH_UNIT;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 116;

COMMIT TRANSACTION;
