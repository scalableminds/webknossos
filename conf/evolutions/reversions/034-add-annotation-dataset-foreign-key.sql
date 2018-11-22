-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

ALTER TABLE webknossos.annotations
	DROP CONSTRAINT dataSet_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 33;

COMMIT TRANSACTION;