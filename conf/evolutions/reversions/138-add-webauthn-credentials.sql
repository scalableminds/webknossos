START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 138, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.webauthnCredentials_;
DROP TABLE webknossos.webauthnCredentials;

UPDATE webknossos.releaseInformation SET schemaVersion = 137;

COMMIT TRANSACTION;
