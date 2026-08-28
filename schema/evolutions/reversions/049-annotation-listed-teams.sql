START TRANSACTION;

DROP TABLE webknossos.annotation_sharedTeams;

UPDATE webknossos.releaseInformation SET schemaVersion = 48;

COMMIT TRANSACTION;
