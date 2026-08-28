START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 145 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments DROP COLUMN realPath;
ALTER TABLE webknossos.dataset_layer_attachments DROP COLUMN hasLocalData;

UPDATE webknossos.releaseInformation SET schemaVersion = 144;

COMMIT TRANSACTION;
