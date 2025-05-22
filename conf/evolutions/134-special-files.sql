START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 133, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TYPE webknossos.SPECIAL_FILE_TYPE AS ENUM ('agglomerate', 'connectome', 'segmentIndex', 'mesh');
CREATE TYPE webknossos.SPECIAL_FILE_DATAFORMAT AS ENUM ('hdf5', 'zarr3');

CREATE TABLE webknossos.dataset_layer_special_files(
   _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
   layerName TEXT NOT NULL,
   path TEXT NOT NULL,
   type webknossos.SPECIAL_FILE_TYPE NOT NULL,
   dataFormat webknossos.SPECIAL_FILE_DATAFORMAT NOT NULL,
   cumsumPath TEXT
);

UPDATE webknossos.releaseInformation SET schemaVersion = 134;

COMMIT TRANSACTION;
