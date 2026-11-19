START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 193 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.datasets_;

-- Unified datasets prototype (features.unifiedDatasets): each dataset may be bound to one backing annotation that
-- holds its annotation layers. _copiedFrom marks a dataset as a copy of another one.
ALTER TABLE webknossos.datasets ADD COLUMN _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') UNIQUE;
ALTER TABLE webknossos.datasets ADD COLUMN _copiedFrom TEXT CONSTRAINT _copiedFrom_objectId CHECK (_copiedFrom ~ '^[0-9a-f]{24}$');

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

CREATE TABLE webknossos.dataset_layer_origins(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  _sourceDataset TEXT CONSTRAINT _sourceDataset_objectId CHECK (_sourceDataset ~ '^[0-9a-f]{24}$') NOT NULL,
  sourceLayerName TEXT NOT NULL,
  PRIMARY KEY (_dataset, layerName)
);

ALTER TABLE webknossos.datasets
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE,
  ADD CONSTRAINT copiedFrom_ref FOREIGN KEY(_copiedFrom) REFERENCES webknossos.datasets(_id) DEFERRABLE;
ALTER TABLE webknossos.dataset_layer_origins
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 194;

COMMIT TRANSACTION;
