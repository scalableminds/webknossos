START TRANSACTION;

DROP TABLE webknossos.shortLinks;

UPDATE webknossos.releaseInformation SET schemaVersion = 87;

COMMIT TRANSACTION;
