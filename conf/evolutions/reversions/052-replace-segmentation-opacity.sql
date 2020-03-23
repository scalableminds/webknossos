START TRANSACTION;

-- set segmentationOpacity based on layer alpha value
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration || jsonb_build_object('segmentationOpacity', configuration->'layers'->dl.name->'alpha')
FROM webknossos.dataSet_layers dl
WHERE webknossos.user_dataSetConfigurations._dataSet = dl._dataset and dl.category = 'segmentation' and configuration->'layers'->dl.name ? 'alpha';

-- remove segmentationLayer configuration
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['layers'],
        (configuration->'layers')::jsonb - dl.name)
from webknossos.dataSet_layers dl
WHERE webknossos.user_dataSetConfigurations._dataSet = dl._dataset and dl.category = 'segmentation' and configuration ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 51;

COMMIT TRANSACTION;
