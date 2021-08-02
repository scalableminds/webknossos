START TRANSACTION;

ALTER TABLE webknossos.jobs DROP CONSTRAINT owner_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 73;

COMMIT TRANSACTION;
