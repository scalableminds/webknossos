START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 162 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments DROP COLUMN uploadIsPending;
ALTER TABLE webknossos.dataset_mags DROP COLUMN uploadIsPending;

UPDATE webknossos.releaseInformation SET schemaVersion = 160;

COMMIT TRANSACTION;
