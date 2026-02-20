START TRANSACTION;

DROP VIEW webknossos.tracingStores_;
DROP TABLE webknossos.tracingStores;

UPDATE webknossos.releaseInformation SET schemaVersion = 29;

COMMIT TRANSACTION;
