
START TRANSACTION;

DROP FUNCTION webknossos.onInsertTask CASCADE;
DROP FUNCTION webknossos.onInsertUserExperience CASCADE;
DROP TABLE webknossos.experienceDomains;

UPDATE webknossos.releaseInformation SET schemaVersion = 20;

COMMIT TRANSACTION;
