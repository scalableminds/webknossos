START TRANSACTION;

DROP VIEW webknossos.tracingStores_;
DROP TABLE webknossos.tracingStores;

UPDATE webknossos.releaseInformation SET schemaVersion = 28;

COMMIT TRANSACTION;
