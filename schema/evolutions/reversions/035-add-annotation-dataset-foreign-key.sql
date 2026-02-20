START TRANSACTION;

ALTER TABLE webknossos.annotations
	DROP CONSTRAINT dataSet_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 34;

COMMIT TRANSACTION;
