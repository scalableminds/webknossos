START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 177 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_layer_attachments DROP COLUMN credentialId;

UPDATE webknossos.releaseInformation SET schemaVersion = 176;

COMMIT TRANSACTION;
