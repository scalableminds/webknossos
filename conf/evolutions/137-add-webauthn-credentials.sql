START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 137, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.webauthnCredentials_;
DROP TABLE webknossos.webauthnCredentials;

UPDATE webknossos.releaseInformation SET schemaVersion = 136;

COMMIT TRANSACTION;
