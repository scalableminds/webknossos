START TRANSACTION;

-- This reversion might take a while because it needs to search in all annotation layer names for '$' and replace it with ''
do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 134, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.webauthnCredentials;

UPDATE webknossos.releaseInformation SET schemaVersion = 133;

COMMIT TRANSACTION;
