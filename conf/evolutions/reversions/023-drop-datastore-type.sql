START TRANSACTION;

DROP VIEW webknossos.datastores_;
ALTER TABLE webknossos.datastores add column typ webknossos.DATASTORE_TYPE NOT NULL DEFAULT 'webknossos-store';
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 22;

COMMIT TRANSACTION;
