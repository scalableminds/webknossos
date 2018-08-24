-- https://github.com/scalableminds/webknossos/pull/TODO


START TRANSACTION;

DROP VIEW webknossos.datastores_;
ALTER TABLE webknossos.datastores DROP COLUMN typ;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 23;

COMMIT TRANSACTION;
