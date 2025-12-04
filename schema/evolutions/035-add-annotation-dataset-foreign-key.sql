-- https://github.com/scalableminds/webknossos/pull/3482

START TRANSACTION;

ALTER TABLE webknossos.annotations
	ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 35;

COMMIT TRANSACTION;
