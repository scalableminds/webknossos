START TRANSACTION;

DROP TABLE webknossos.dataSet_layer_additionalCoordinates;

UPDATE webknossos.releaseInformation SET schemaVersion = 106;

COMMIT TRANSACTION;
