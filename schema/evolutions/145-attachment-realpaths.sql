START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 144 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN realPath TEXT;
ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN hasLocalData BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
