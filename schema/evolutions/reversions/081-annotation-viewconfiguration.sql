START TRANSACTION;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations DROP COLUMN viewConfiguration;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 80;

COMMIT TRANSACTION;
