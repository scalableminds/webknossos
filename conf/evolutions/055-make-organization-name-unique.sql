-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

ALTER TABLE webknossos.organizations ADD CONSTRAINT organization_name_unique UNIQUE (name);

UPDATE webknossos.releaseInformation SET schemaVersion = 55;

COMMIT TRANSACTION;
