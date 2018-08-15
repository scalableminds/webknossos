START TRANSACTION;
DROP VIEW webknossos.datastores_;
ALTER TABLE webknossos.datastores DROP COLUMN isForeign;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;
COMMIT TRANSACTION;
