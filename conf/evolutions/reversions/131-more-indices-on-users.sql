START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 131, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS ON webknossos.users(created);
DROP INDEX IF EXISTS ON webknossos.users(_organization);
DROP INDEX IF EXISTS ON webknossos.users(isDeactivated);
DROP INDEX IF EXISTS ON webknossos.users(isUnlisted);

UPDATE webknossos.releaseInformation SET schemaVersion = 130;

COMMIT TRANSACTION;
