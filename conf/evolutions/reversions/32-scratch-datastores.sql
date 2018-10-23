START TRANSACTION;

ALTER TABLE webknossos.dataStores DROP COLUMN isScratch;

UPDATE webknossos.releaseInformation SET schemaVersion = 31;

COMMIT TRANSACTION;
