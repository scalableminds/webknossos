
START TRANSACTION;

DROP VIEW webknossos.jobs_;
DROP TABLE webknossos.jobs;

UPDATE webknossos.releaseInformation SET schemaVersion = 55;

COMMIT TRANSACTION;
