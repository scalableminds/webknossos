-- https://github.com/scalableminds/webknossos/pull/4357

START TRANSACTION;

-- Update alpha value of segmentation layer based on segmentationOpacity
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['configuration','layers'],
        (configuration->'configuration'->'layers')::jsonb || jsonb_build_object(dl.name, jsonb_build_object('alpha', configuration->'configuration'->'segmentationOpacity')))
FROM webknossos.dataSet_layers dl
WHERE _dataSet = dl._dataset and dl.category = 'segmentation' and configuration->'configuration' ? 'segmentationOpacity';

-- Remove segmentationOpacityField
UPDATE webknossos.user_dataSetConfigurations
SET configuration = jsonb_set(
        configuration,
        array['configuration'],
        (configuration->'configuration')::jsonb - 'segmentationOpacity')
WHERE configuration->'configuration' ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 52;

COMMIT TRANSACTION;
