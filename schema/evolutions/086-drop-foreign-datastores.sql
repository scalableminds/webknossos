START TRANSACTION;

DROP VIEW webknossos.datastores_;
ALTER TABLE webknossos.datastores DROP COLUMN isForeign;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 86;

COMMIT TRANSACTION;
