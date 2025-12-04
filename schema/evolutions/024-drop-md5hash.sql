-- https://github.com/scalableminds/webknossos/pull/3109


START TRANSACTION;

DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users DROP COLUMN md5hash;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 24;

COMMIT TRANSACTION;
