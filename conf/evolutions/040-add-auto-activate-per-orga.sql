-- https://github.com/scalableminds/webknossos/pull/3741

START TRANSACTION;

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations ADD COLUMN enableAutoVerify BOOLEAN NOT NULL DEFAULT false;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 40;

COMMIT TRANSACTION;
