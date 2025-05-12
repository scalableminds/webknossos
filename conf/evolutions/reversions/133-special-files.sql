START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 133, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.dataset_layer_special_files;

UPDATE webknossos.releaseInformation SET schemaVersion = 132;

COMMIT TRANSACTION;
