START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 133, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TYPE webknossos.LAYER_ATTACHMENT_TYPE AS ENUM ('agglomerate', 'connectome', 'segmentIndex', 'mesh', 'cumsum');
CREATE TYPE webknossos.LAYER_ATTACHMENT_DATAFORMAT AS ENUM ('hdf5', 'zarr3', 'json');

CREATE TABLE webknossos.dataset_layer_attachments(
   _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
   layerName TEXT NOT NULL,
   name TEXT NOT NULL,
   path TEXT NOT NULL,
   type webknossos.LAYER_ATTACHMENT_TYPE NOT NULL,
   dataFormat webknossos.LAYER_ATTACHMENT_DATAFORMAT NOT NULL,
   PRIMARY KEY(_dataset, layerName, name, type)
);

ALTER TABLE webknossos.dataset_layer_attachments
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) DEFERRABLE,
  ADD CONSTRAINT layer_ref FOREIGN KEY(_dataset, layerName) REFERENCES webknossos.dataset_layers(_dataset, name) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 134;

COMMIT TRANSACTION;
