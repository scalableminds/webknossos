-- https://github.com/scalableminds/webknossos/pull/X

START TRANSACTION;

DROP VIEW webknossos.users_;

ALTER TABLE webknossos.users ADD COLUMN layoutConfiguration JSONB NOT NULL;

CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 43;

COMMIT TRANSACTION;
