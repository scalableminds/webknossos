START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 103, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.dataSet_layer_coordinateTransformations DROP COLUMN correspondences;
ALTER TABLE webknossos.dataSet_layer_coordinateTransformations DROP COLUMN insertionOrderIndex;

UPDATE webknossos.releaseInformation SET schemaVersion = 102;

COMMIT TRANSACTION;
