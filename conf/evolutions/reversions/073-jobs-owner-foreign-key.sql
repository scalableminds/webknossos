START TRANSACTION;

ALTER TABLE webknossos.jobs DROP CONSTRAINT owner_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 72;

COMMIT TRANSACTION;
