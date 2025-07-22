START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 136, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.datasets DROP COLUMN IF EXISTS isVirtual;

UPDATE webknossos.releaseInformation SET schemaVersion = 135;

COMMIT TRANSACTION;
