START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 132, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.dataset_layer_special_files;

UPDATE webknossos.releaseInformation SET schemaVersion = 131;

COMMIT TRANSACTION;
