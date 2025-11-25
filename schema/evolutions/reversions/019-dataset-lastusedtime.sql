
START TRANSACTION;

DROP TABLE webknossos.dataSet_lastUsedTimes;

UPDATE webknossos.releaseInformation SET schemaVersion = 18;

COMMIT TRANSACTION;
