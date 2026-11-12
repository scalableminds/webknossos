START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 187 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP INDEX IF EXISTS webknossos.dataset_layer_coordinatetransformations__dataset_layername_idx;
DROP INDEX IF EXISTS webknossos.dataset_layer_additionalaxes__dataset_layername_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
