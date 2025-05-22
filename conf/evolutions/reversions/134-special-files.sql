START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 134, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.dataset_layer_special_files;
DROP TYPE IF EXISTS webknossos.SPECIAL_FILE_TYPE;
DROP TYPE IF EXISTS webknossos.SPECIAL_FILE_DATAFORMAT;

UPDATE webknossos.releaseInformation SET schemaVersion = 133;

COMMIT TRANSACTION;
