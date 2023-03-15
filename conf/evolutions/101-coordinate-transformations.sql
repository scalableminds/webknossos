START TRANSACTION;

CREATE TABLE webknossos.dataSet_layer_coordinateTransformations(
  _dataSet CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  type VARCHAR(256) NOT NULL,
  matrix JSONB
);

ALTER TABLE webknossos.dataSet_layer_coordinateTransformations
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) DEFERRABLE;

-- Update default gpuMemoryFactor from 3 to 4 in user configuration
UPDATE webknossos.users
SET userconfiguration = CASE
WHEN (userconfiguration->>'gpuMemoryFactor')::NUMERIC = 3 THEN jsonb_set(
        userconfiguration,
        array['gpuMemoryFactor'],
        to_jsonb(4::NUMERIC))
else
  userconfiguration
END
WHERE userconfiguration ? 'gpuMemoryFactor';

-- Do the same for recommended configurations of task types
UPDATE webknossos.tasktypes
SET recommendedconfiguration = CASE
WHEN (recommendedconfiguration->>'gpuMemoryFactor')::NUMERIC = 3 THEN jsonb_set(
        recommendedconfiguration,
        array['gpuMemoryFactor'],
        to_jsonb(4::NUMERIC))
else
  recommendedconfiguration
END
WHERE recommendedconfiguration ? 'gpuMemoryFactor';

-- Disable interpolation for all users for performance reasons.
UPDATE webknossos.user_dataSetConfigurations
SET viewconfiguration = CASE
WHEN jsonb_typeof(viewconfiguration->'interpolation') = 'boolean' AND (viewconfiguration->>'interpolation')::boolean IS TRUE THEN jsonb_set(
        viewconfiguration,
        array['interpolation'],
        to_jsonb(FALSE))
else
  viewconfiguration
END
WHERE viewconfiguration ? 'interpolation';

UPDATE webknossos.releaseInformation SET schemaVersion = 101;

COMMIT TRANSACTION;
