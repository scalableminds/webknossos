START TRANSACTION;

DROP TABLE webknossos.shortlinks;

UPDATE webknossos.releaseInformation SET schemaVersion = 87;

COMMIT TRANSACTION;
