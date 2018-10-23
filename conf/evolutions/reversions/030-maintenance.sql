
START TRANSACTION;

DROP TABLE webknossos.maintenance;
UPDATE webknossos.releaseInformation SET schemaVersion = 29;

COMMIT TRANSACTION;
