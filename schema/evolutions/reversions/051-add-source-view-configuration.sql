START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets DROP COLUMN sourceDefaultConfiguration;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

ALTER TABLE webknossos.dataSets DROP CONSTRAINT sourceDefaultConfigurationIsJsonObject;

ALTER TABLE webknossos.dataSet_layers DROP COLUMN defaultViewConfiguration;
ALTER TABLE webknossos.dataSet_layers DROP CONSTRAINT defaultViewConfigurationIsJsonObject;

-- set segmentationOpacity based on layer alpha value
UPDATE webknossos.datasets
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['configuration'],
        (defaultConfiguration->'configuration')::jsonb || jsonb_build_object('segmentationOpacity', defaultconfiguration->'configuration'->'layers'->dl.name->'alpha'))
from webknossos.dataSet_layers dl
WHERE _id = dl._dataset and dl.category = 'segmentation';

-- remove segmentationLayer configuration
UPDATE webknossos.datasets
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['configuration','layers'],
        (defaultConfiguration->'configuration'->'layers')::jsonb - dl.name)
from webknossos.dataSet_layers dl
WHERE _id = dl._dataset and dl.category = 'segmentation' and defaultconfiguration->'configuration' ? 'segmentationOpacity';

UPDATE webknossos.releaseInformation SET schemaVersion = 50;

COMMIT TRANSACTION;
