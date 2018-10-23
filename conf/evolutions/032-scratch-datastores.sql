-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

ALTER TABLE webknossos.dataStores ADD COLUMN isScratch BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.releaseInformation SET schemaVersion = 32;

COMMIT TRANSACTION;
