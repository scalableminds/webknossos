START TRANSACTION;

DROP TABLE webknossos.credentials;
DROP TYPE webknossos.CREDENTIAL_TYPE;

UPDATE webknossos.releaseInformation SET schemaVersion = 91;

COMMIT TRANSACTION;
