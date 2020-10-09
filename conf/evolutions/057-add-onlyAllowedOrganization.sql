-- https://github.com/scalableminds/webknossos/pull/4XXX

START TRANSACTION;

DROP VIEW webknossos.dataStores_;

ALTER TABLE webknossos.dataStores ADD COLUMN onlyAllowedOrganization CHAR(24);

CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 57;

COMMIT TRANSACTION;
