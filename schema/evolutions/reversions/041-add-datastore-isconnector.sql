START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores DROP COLUMN isConnector;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 40;

COMMIT TRANSACTION;
