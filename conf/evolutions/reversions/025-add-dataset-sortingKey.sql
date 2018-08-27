START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets DROP COLUMN sortingKey;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 24;

COMMIT TRANSACTION;
