START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 145 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.jobs ADD COLUMN lastRetry TIMESTAMPTZ;

UPDATE webknossos.releaseInformation SET schemaVersion = 146;

COMMIT TRANSACTION;
