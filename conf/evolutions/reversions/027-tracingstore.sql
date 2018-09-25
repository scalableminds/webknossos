START TRANSACTION;

DROP VIEW webknossos.tracingStores_;
DROP TABLE webknossos.tracingStores;

UPDATE webknossos.releaseInformation SET schemaVersion = 26;

COMMIT TRANSACTION;
