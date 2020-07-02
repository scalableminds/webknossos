
START TRANSACTION;

ALTER TABLE webknossos.organizations DROP CONSTRAINT organizations_name_key;

UPDATE webknossos.releaseInformation SET schemaVersion = 54;

COMMIT TRANSACTION;
