-- https://github.com/scalableminds/webknossos/pull/4357

START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets ADD COLUMN sourceDefaultConfiguration JSONB;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

ALTER TABLE webknossos.dataSets ADD CONSTRAINT sourceDefaultConfigurationIsJsonObject CHECK(jsonb_typeof(sourceDefaultConfiguration) = 'object');

ALTER TABLE webknossos.dataSet_layers ADD COLUMN defaultViewConfiguration JSONB;
ALTER TABLE webknossos.dataSet_layers ADD CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object');

-- Update alpha value of segmentation layer based on segmentationOpacity
UPDATE webknossos.datasets
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['configuration','layers'],
        (defaultConfiguration->'configuration'->'layers')::jsonb || jsonb_build_object(dl.name, jsonb_build_object('alpha', defaultconfiguration->'configuration'->'segmentationOpacity')))
FROM webknossos.dataSet_layers dl
WHERE _id = dl._dataset and dl.category = 'segmentation' and defaultconfiguration->'configuration' ? 'segmentationOpacity';

-- Remove segmentationOpacityField
UPDATE webknossos.datasets
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['configuration'],
        (defaultConfiguration->'configuration')::jsonb - 'segmentationOpacity')
WHERE defaultconfiguration->'configuration' ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 50;

COMMIT TRANSACTION;
