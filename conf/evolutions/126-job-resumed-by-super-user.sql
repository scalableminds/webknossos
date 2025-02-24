START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.jobs ADD column resumedBySuperUser boolean NOT NULL DEFAULT false;
UPDATE webknossos.releaseInformation SET schemaVersion = 126;

COMMIT TRANSACTION;
