START TRANSACTION;

DROP VIEW webknossos.users_;

ALTER TABLE webknossos.users DROP COLUMN layoutConfiguration;

CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 42;

COMMIT TRANSACTION;
