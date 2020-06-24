
START TRANSACTION;

ALTER TABLE webknossos.organizations DROP CONSTRAINT organization_name_unique;

UPDATE webknossos.releaseInformation SET schemaVersion = 54;

COMMIT TRANSACTION;
