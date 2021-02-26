START TRANSACTION;

ALTER TABLE webknossos.dataSets DROP CONSTRAINT publication_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 65;

COMMIT TRANSACTION;
