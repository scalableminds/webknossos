START TRANSACTION;

DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users ADD COLUMN md5hash VARCHAR(32) NOT NULL DEFAULT '',
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 23;

COMMIT TRANSACTION;
