START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 130, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE INDEX ON webknossos.users(created);
CREATE INDEX ON webknossos.users(_organization);
CREATE INDEX ON webknossos.users(isDeactivated);
CREATE INDEX ON webknossos.users(isUnlisted);

UPDATE webknossos.releaseInformation SET schemaVersion = 131;

COMMIT TRANSACTION;
