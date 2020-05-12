-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores ADD COLUMN allowsUpload BOOLEAN NOT NULL DEFAULT true;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 53;

COMMIT TRANSACTION;
