START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 161 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN uploadIsPending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webknossos.dataset_mags ADD COLUMN uploadIsPending BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE webknossos.releaseInformation SET schemaVersion = 162;

COMMIT TRANSACTION;
