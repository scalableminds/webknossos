START TRANSACTION;

DROP TABLE webknossos.dataSet_layer_coordinateTransformations;

-- Restore default gpuMemoryFactor from 4 to 3 in user configuration
UPDATE webknossos.users
SET userconfiguration = CASE
WHEN (userconfiguration->>'gpuMemoryFactor')::NUMERIC = 4 THEN jsonb_set(
        userconfiguration,
        array['gpuMemoryFactor'],
        to_jsonb(3::NUMERIC))
else
  userconfiguration
END
WHERE userconfiguration ? 'gpuMemoryFactor';

-- Do the same for recommended configurations of task types
UPDATE webknossos.tasktypes
SET recommendedconfiguration = CASE
WHEN (recommendedconfiguration->>'gpuMemoryFactor')::NUMERIC = 4 THEN jsonb_set(
        recommendedconfiguration,
        array['gpuMemoryFactor'],
        to_jsonb(3::NUMERIC))
else
  recommendedconfiguration
END
WHERE recommendedconfiguration ? 'gpuMemoryFactor';

UPDATE webknossos.releaseInformation SET schemaVersion = 100;

COMMIT TRANSACTION;
