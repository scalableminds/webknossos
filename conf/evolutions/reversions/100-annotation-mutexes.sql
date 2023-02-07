START TRANSACTION;

DROP TABLE webknossos.annotation_mutexes;

UPDATE webknossos.releaseInformation
SET schemaVersion = 99;

COMMIT TRANSACTION;
