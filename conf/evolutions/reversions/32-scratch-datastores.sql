START TRANSACTION;

DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores DROP COLUMN isScratch;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 31;

COMMIT TRANSACTION;
