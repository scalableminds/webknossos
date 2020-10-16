
START TRANSACTION;

-- pre-aggregate all layer jsons into one json object, set json object in configuration
UPDATE webknossos.user_dataSetConfigurations dsC
SET configuration = jsonb_set(
        dsC.configuration,
        array['layers'],
        subQ.json)
FROM (select _user, _dataset, jsonb_object_agg(layerName, configuration) AS json FROM webknossos.user_dataSetLayerConfigurations dlC GROUP BY _user, _dataset) AS subQ
WHERE dsC._user = subQ._user and dsC._dataset = subQ._dataset;

--Rename view configuration back to old naming
ALTER TABLE webknossos.user_dataSetConfigurations RENAME COLUMN viewConfiguration TO configuration;
ALTER TABLE webknossos.user_dataSetConfigurations RENAME CONSTRAINT viewConfigurationIsJsonObject TO configurationIsJsonObject;

--drop unused table
DROP TABLE webknossos.user_dataSetLayerConfigurations;

--rename back to original
DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets RENAME COLUMN defaultViewConfiguration TO sourceDefaultConfiguration;
ALTER TABLE webknossos.dataSets RENAME COLUMN adminViewConfiguration TO defaultConfiguration;
ALTER TABLE webknossos.dataSets RENAME CONSTRAINT defaultViewConfigurationIsJsonObject TO sourceDefaultConfigurationIsJsonObject;
ALTER TABLE webknossos.dataSets RENAME CONSTRAINT adminViewConfigurationIsJsonObject TO defaultConfigurationIsJsonObject;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.dataSets ds
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['layers'],
        subQ.json)
FROM (select _dataset, jsonb_object_agg(name, adminViewConfiguration) AS json FROM webknossos.dataSet_layers dl GROUP BY _dataset) AS subQ
WHERE ds._id = subQ._dataset;

--drop admin view configuration for layers
ALTER TABLE webknossos.dataSet_layers DROP CONSTRAINT adminViewConfigurationIsJsonObject;
ALTER TABLE webknossos.dataSet_layers DROP COLUMN adminViewConfiguration;

--add configuration container from defaultConfig
UPDATE webknossos.dataSets
SET defaultConfiguration = jsonb_set(
        defaultConfiguration,
        array['configuration'],
        defaultConfiguration)
WHERE defaultConfiguration is not null;

UPDATE webknossos.releaseInformation SET schemaVersion = 55;

COMMIT TRANSACTION;
