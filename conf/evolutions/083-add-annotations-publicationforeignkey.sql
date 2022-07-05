START TRANSACTION;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD COLUMN _publication CHAR(24);

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 83;

COMMIT TRANSACTION;
