
START TRANSACTION;

DROP TABLE webknossos.annotation_listedTeams;

UPDATE webknossos.releaseInformation SET schemaVersion = 47;

COMMIT TRANSACTION;
