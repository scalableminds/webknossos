START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 136, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.webauthnCredentials;
DROP VIEW webknossos.webauthnCredentials_;

UPDATE webknossos.releaseInformation SET schemaVersion = 135;

COMMIT TRANSACTION;
