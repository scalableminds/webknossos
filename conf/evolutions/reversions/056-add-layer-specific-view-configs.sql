
START TRANSACTION;

-- pre-aggregate all layer jsons into one json object, set json object in configuration
UPDATE webknossos.user_dataSetConfigurations dsC
SET configuration = jsonb_set(
        dsC.configuration,
        array['layers'],
        subQ.json)
FROM (select _user, _dataset, jsonb_object_agg(layerName, configuration) AS json FROM webknossos.user_dataSetLayerConfigurations dlC GROUP BY _user, _dataset) AS subQ
WHERE dsC._user = subQ._user and dsC._dataset = subQ._dataset;

DROP TABLE webknossos.user_dataSetLayerConfigurations;

UPDATE webknossos.releaseInformation SET schemaVersion = 55;

COMMIT TRANSACTION;
