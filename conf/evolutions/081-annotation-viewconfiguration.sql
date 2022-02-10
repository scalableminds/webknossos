START TRANSACTION;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN viewConfiguration JSONB;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 81;

COMMIT TRANSACTION;
