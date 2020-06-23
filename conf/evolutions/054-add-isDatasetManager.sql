-- https://github.com/scalableminds/webknossos/pull/4663

START TRANSACTION;

DROP VIEW webknossos.users_;

ALTER TABLE webknossos.users ADD COLUMN isDatasetManager BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.users SET isDatasetManager = true WHERE _id IN (SELECT _user FROM webknossos.user_team_roles WHERE isTeamManager);

CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 54;

COMMIT TRANSACTION;
