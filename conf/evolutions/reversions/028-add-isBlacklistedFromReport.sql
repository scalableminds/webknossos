START TRANSACTION;
DROP VIEW webknossos.projects_;
ALTER TABLE webknossos.projects DROP COLUMN isBlacklistedFromReport;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 27;

COMMIT TRANSACTION;
