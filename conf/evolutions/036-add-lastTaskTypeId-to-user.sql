-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

DROP VIEW webknossos.users_;

ALTER TABLE webknossos.users ADD lastTaskTypeId CHAR(24) DEFAULT NULL;

CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 36;

COMMIT TRANSACTION;
