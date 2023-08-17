START TRANSACTION;

DROP TABLE webknossos.dataSet_layer_additionalCoordinates;

UPDATE webknossos.releaseInformation SET schemaVersion = 107;

COMMIT TRANSACTION;
