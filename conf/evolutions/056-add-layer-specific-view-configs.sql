-- https://github.com/scalableminds/webknossos/pull/4XXX

START TRANSACTION;

CREATE TABLE webknossos.user_dataSetLayerConfigurations(
    _user CHAR(24) NOT NULL,
    _dataSet CHAR(24) NOT NULL,
    layerName VARCHAR(256) NOT NULL,
    configuration JSONB NOT NULL,
    PRIMARY KEY (_user, _dataSet, layerName),
    CONSTRAINT configurationIsJsonObject CHECK(jsonb_typeof(configuration) = 'object')
);

ALTER TABLE webknossos.user_dataSetLayerConfigurations
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE DEFERRABLE;

-- Insert the layer configs into the new table
INSERT INTO webknossos.user_dataSetLayerConfigurations(_user, _dataset, layerName, configuration)
SELECT _user, _dataset, (js).key AS layerName, (js).value AS config FROM (SELECT _user, _dataset, jsonb_each(configuration->'layers') AS js FROM webknossos.user_dataSetConfigurations WHERE configuration ? 'layers') AS sub_q;


-- Remove layers field from old table
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration - 'layers'
WHERE configuration ? 'layers';

--remove unused field quality
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration - 'quality'
WHERE configuration ? 'quality';


UPDATE webknossos.releaseInformation SET schemaVersion = 56;

COMMIT TRANSACTION;
