-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores ADD COLUMN isConnector BOOLEAN NOT NULL DEFAULT false;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 41;

COMMIT TRANSACTION;
