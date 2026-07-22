START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 176 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.TOKEN_TYPES ADD VALUE IF NOT EXISTS 'Job';

UPDATE webknossos.releaseInformation SET schemaVersion = 177;

COMMIT TRANSACTION;
