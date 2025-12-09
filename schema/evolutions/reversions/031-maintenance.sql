
START TRANSACTION;

DROP TABLE webknossos.maintenance;
UPDATE webknossos.releaseInformation SET schemaVersion = 30;

COMMIT TRANSACTION;
