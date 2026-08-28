START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 137, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.datasets_;
ALTER TABLE webknossos.datasets DROP COLUMN IF EXISTS isVirtual;
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

ALTER TABLE webknossos.dataset_mags ADD COLUMN IF NOT EXISTS cubelength INTEGER;

UPDATE webknossos.releaseInformation SET schemaVersion = 136;

COMMIT TRANSACTION;
