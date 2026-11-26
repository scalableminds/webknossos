START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 195 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.LAYER_ATTACHMENT_DATAFORMAT ADD VALUE IF NOT EXISTS 'pcg';

UPDATE webknossos.releaseInformation SET schemaVersion = 196;

COMMIT TRANSACTION;
