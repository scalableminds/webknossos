START TRANSACTION;

DO $$ BEGIN IF (SELECT schemaVersion FROM webknossos.releaseInformation) <> 145 THEN raise exception 'Previous schema version mismatch'; END IF; END; $$ language plpgsql;

ALTER TABLE webknossos.annotation_layers ADD COLUMN hasEditableMapping BOOLEAN DEFAULT NULL;
ALTER TABLE webknossos.annotation_layers ADD COLUMN fallbackLayerName TEXT DEFAULT NULL;
ALTER TABLE webknossos.annotation_layers ADD COLUMN mappingName TEXT DEFAULT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 146;

COMMIT TRANSACTION;
