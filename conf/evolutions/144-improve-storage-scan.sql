START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 143 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE INDEX ON webknossos.dataset_mags (COALESCE(realPath, path));
CREATE INDEX ON webknossos.dataset_layer_attachments path

UPDATE webknossos.releaseInformation SET schemaVersion = 144;

COMMIT TRANSACTION;
