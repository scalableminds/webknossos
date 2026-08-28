START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.dataset_mags DROP COLUMN realPath;
ALTER TABLE webknossos.dataset_mags DROP COLUMN path;
ALTER TABLE webknossos.dataset_mags DROP COLUMN hasLocalData;

UPDATE webknossos.releaseInformation SET schemaVersion = 125;

COMMIT TRANSACTION;
