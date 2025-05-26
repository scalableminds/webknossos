START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 133, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TYPE webknossos.ATTACHMENT_FILE_TYPE AS ENUM ('agglomerate', 'connectome', 'segmentIndex', 'mesh', 'cumsum');
CREATE TYPE webknossos.ATTACHMENT_DATAFORMAT AS ENUM ('hdf5', 'zarr3', 'json');

CREATE TABLE webknossos.dataset_layer_attachments(
   _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
   layerName TEXT NOT NULL,
   path TEXT NOT NULL,
   type webknossos.ATTACHMENT_FILE_TYPE NOT NULL,
   dataFormat webknossos.ATTACHMENT_DATAFORMAT NOT NULL
);

UPDATE webknossos.releaseInformation SET schemaVersion = 134;

COMMIT TRANSACTION;
