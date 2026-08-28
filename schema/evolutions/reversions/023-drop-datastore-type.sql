START TRANSACTION;

DROP VIEW webknossos.datastores_;
ALTER TABLE webknossos.datastores ADD COLUMN typ webknossos.DATASTORE_TYPE NOT NULL DEFAULT 'webknossos-store';
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 22;

COMMIT TRANSACTION;
