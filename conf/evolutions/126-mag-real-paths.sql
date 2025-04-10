START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.dataset_mags ADD COLUMN realPath TEXT;
ALTER TABLE webknossos.dataset_mags ADD COLUMN path TEXT;
ALTER TABLE webknossos.dataset_mags ADD COLUMN hasLocalData BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.releaseInformation SET schemaVersion = 126;


COMMIT TRANSACTION;
