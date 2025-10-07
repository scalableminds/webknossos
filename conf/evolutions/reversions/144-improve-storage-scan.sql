START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 144 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP INDEX IF EXISTS webknossos.dataset_mags_coalesce_realpath_path_idx;
DROP INDEX IF EXISTS webknossos.dataset_layer_attachments_path_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 143;


COMMIT TRANSACTION;
