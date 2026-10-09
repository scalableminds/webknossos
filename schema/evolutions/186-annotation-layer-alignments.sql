START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.annotation_layerAlignments(
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  fixedLayerName TEXT NOT NULL,
  movingLayerName TEXT NOT NULL,
  CONSTRAINT differentLayers CHECK (fixedLayerName <> movingLayerName)
);

ALTER TABLE webknossos.annotation_layerAlignments
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
