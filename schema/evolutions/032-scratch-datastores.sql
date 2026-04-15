-- https://github.com/scalableminds/webknossos/pull/3394

START TRANSACTION;

DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores ADD COLUMN isScratch BOOLEAN NOT NULL DEFAULT false;

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 32;

COMMIT TRANSACTION;
