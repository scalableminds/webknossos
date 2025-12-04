START TRANSACTION;

DO $$ BEGIN IF (SELECT schemaVersion FROM webknossos.releaseInformation) <> 146 THEN raise exception 'Previous schema version mismatch'; END IF; END; $$ language plpgsql;

ALTER TABLE webknossos.annotation_layers DROP COLUMN hasEditableMapping;
ALTER TABLE webknossos.annotation_layers DROP COLUMN fallbackLayerName;
ALTER TABLE webknossos.annotation_layers DROP COLUMN mappingName;

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
