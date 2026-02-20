START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores DROP publicUrl;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 46;

COMMIT TRANSACTION;
