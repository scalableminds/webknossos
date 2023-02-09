START TRANSACTION;

DROP TABLE webknossos.dataSet_layer_coordinateTransformations;

UPDATE webknossos.releaseInformation SET schemaVersion = 100;

COMMIT TRANSACTION;
