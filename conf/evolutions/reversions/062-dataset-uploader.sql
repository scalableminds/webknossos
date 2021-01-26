START TRANSACTION;

ALTER TABLE webknossos.dataSets DROP CONSTRAINT uploader_ref;
UPDATE webknossos.datasets DROP COLUMN _uploader;

UPDATE webknossos.releaseInformation SET schemaVersion = 60;

COMMIT TRANSACTION;
