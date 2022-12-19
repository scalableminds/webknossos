START TRANSACTION;

DROP TABLE webknossos.credentials;
DROP TYPE webknossos.CREDENTIAL_TYPE;
DROP VIEW webknossos.credentials_;

UPDATE webknossos.releaseInformation SET schemaVersion = 92;

COMMIT TRANSACTION;
