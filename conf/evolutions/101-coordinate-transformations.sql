START TRANSACTION;

CREATE TABLE webknossos.dataSet_layer_coordinateTransformations(
  _dataSet CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  type VARCHAR(256) NOT NULL,
  matrix JSONB
);

ALTER TABLE webknossos.dataSet_layer_coordinateTransformations
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 101;

COMMIT TRANSACTION;
