START TRANSACTION;

CREATE TABLE webknossos.dataSet_layer_additionalAxes(
   _dataSet CHAR(24) NOT NULL,
   layerName VARCHAR(256) NOT NULL,
   name VARCHAR(256) NOT NULL,
   lowerBound INT NOT NULL,
   upperBound INT NOT NULL,
   index INT NOT NULL
);

ALTER TABLE webknossos.dataSet_layer_additionalAxes
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 108;

COMMIT TRANSACTION;
