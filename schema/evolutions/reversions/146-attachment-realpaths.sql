START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 146 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.jobs DROP COLUMN lastRetry;

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
