START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 102, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.dataSet_layer_coordinateTransformations ADD COLUMN correspondences JSONB;
ALTER TABLE webknossos.dataSet_layer_coordinateTransformations ADD COLUMN insertionOrderIndex INT; -- optional for backwards compatibility,

UPDATE webknossos.releaseInformation SET schemaVersion = 103;

COMMIT TRANSACTION;
