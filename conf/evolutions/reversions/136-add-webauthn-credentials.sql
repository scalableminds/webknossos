START TRANSACTION;

-- This reversion might take a while because it needs to search in all annotation layer names for '$' and replace it with ''
do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 135, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.webauthnCredentials;
DROP VIEW webknossos.webauthnCredentials_;

UPDATE webknossos.releaseInformation SET schemaVersion = 135;

COMMIT TRANSACTION;
