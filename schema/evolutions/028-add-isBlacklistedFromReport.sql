-- https://github.com/scalableminds/webknossos/pull/3321

START TRANSACTION;
DROP VIEW webknossos.projects_;
ALTER TABLE webknossos.projects ADD COLUMN isBlacklistedFromReport BOOLEAN NOT NULL DEFAULT false;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 28;

COMMIT TRANSACTION;
