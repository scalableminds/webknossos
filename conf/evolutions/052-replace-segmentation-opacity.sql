-- https://github.com/scalableminds/webknossos/pull/4484

START TRANSACTION;

-- Update alpha value of segmentation layer based on segmentationOpacity
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['layers'],
        (configuration->'layers')::jsonb || jsonb_build_object(dl.name, jsonb_build_object('alpha', configuration->'segmentationOpacity')))
FROM webknossos.dataSet_layers dl
WHERE webknossos.user_dataSetConfigurations._dataSet = dl._dataset and dl.category = 'segmentation' and configuration ? 'segmentationOpacity';

-- Remove segmentationOpacityField
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration - 'segmentationOpacity'
WHERE configuration ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 52;

COMMIT TRANSACTION;
