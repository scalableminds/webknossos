START TRANSACTION;

-- set segmentationOpacity based on layer alpha value
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['configuration'],
        (configuration->'configuration')::jsonb || jsonb_build_object('segmentationOpacity', configuration->'configuration'->'layers'->dl.name->'alpha'))
from webknossos.dataSet_layers dl
WHERE _dataSet = dl._dataset and dl.category = 'segmentation';

-- remove segmentationLayer configuration
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['configuration','layers'],
        (configuration->'configuration'->'layers')::jsonb - dl.name)
from webknossos.dataSet_layers dl
WHERE _dataSet = dl._dataset and dl.category = 'segmentation' and configuration->'configuration' ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 51;

COMMIT TRANSACTION;
