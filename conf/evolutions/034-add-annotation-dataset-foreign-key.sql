-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

ALTER TABLE webknossos.annotations
	ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 34;

COMMIT TRANSACTION;