-- https://github.com/scalableminds/webknossos/pull/4685

START TRANSACTION;

ALTER TABLE webknossos.organizations ADD CONSTRAINT organizations_name_key UNIQUE (name);

UPDATE webknossos.releaseInformation SET schemaVersion = 55;

COMMIT TRANSACTION;
