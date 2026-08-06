START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 176 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN credentialId TEXT;

UPDATE webknossos.releaseInformation SET schemaVersion = 177;

COMMIT TRANSACTION;
