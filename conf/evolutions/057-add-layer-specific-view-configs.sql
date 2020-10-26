-- https://github.com/scalableminds/webknossos/pull/4845

START TRANSACTION;

CREATE TABLE webknossos.user_dataSetLayerConfigurations(
  _user CHAR(24) NOT NULL,
  _dataSet CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataSet, layerName),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

ALTER TABLE webknossos.user_dataSetLayerConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE DEFERRABLE;

-- Insert the layer configs into the new table
INSERT INTO webknossos.user_dataSetLayerConfigurations(_user, _dataset, layerName, viewConfiguration)
SELECT _user, _dataset, (js).key AS layerName, (js).value AS config FROM (SELECT _user, _dataset, jsonb_each(configuration->'layers') AS js FROM webknossos.user_dataSetConfigurations WHERE configuration ? 'layers') AS sub_q;

-- Remove layers field from old table
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration - 'layers'
WHERE configuration ? 'layers';

--remove unused field quality
UPDATE webknossos.user_dataSetConfigurations
SET configuration = configuration - 'quality'
WHERE configuration ? 'quality';

--Adapt naming of dataset view configuration to match layer naming
DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets RENAME COLUMN sourceDefaultConfiguration TO defaultViewConfiguration;
ALTER TABLE webknossos.dataSets RENAME COLUMN defaultConfiguration TO adminViewConfiguration;
ALTER TABLE webknossos.dataSets RENAME CONSTRAINT sourceDefaultConfigurationIsJsonObject TO defaultViewConfigurationIsJsonObject;
ALTER TABLE webknossos.dataSets RENAME CONSTRAINT defaultConfigurationIsJsonObject TO adminViewConfigurationIsJsonObject;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

--remove unnecessary configuration container from defaultConfig
UPDATE webknossos.dataSets
SET adminViewConfiguration = adminViewConfiguration->'configuration'
WHERE adminViewConfiguration ? 'configuration';

--ADD admin view configuration for layers
ALTER TABLE webknossos.dataSet_layers ADD COLUMN adminViewConfiguration JSONB;
ALTER TABLE webknossos.dataSet_layers ADD CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object');

--split default configuration as well
UPDATE webknossos.dataSet_layers dl
SET adminViewConfiguration = dS.adminViewConfiguration->'layers'->dl.name
FROM webknossos.dataSets dS
WHERE dl._dataSet = dS._id AND dS.adminViewConfiguration ? 'layers' AND dS.adminViewConfiguration->'layers' ? dl.name;

-- Remove layers field from old table
UPDATE webknossos.dataSets
SET adminViewConfiguration = adminViewConfiguration - 'layers'
WHERE adminViewConfiguration ? 'layers';

--remove unused field quality
UPDATE webknossos.dataSets
SET adminViewConfiguration = adminViewConfiguration - 'quality'
WHERE adminViewConfiguration ? 'quality';

--Rename view configuration to reflect new naming standard
ALTER TABLE webknossos.user_dataSetConfigurations RENAME COLUMN configuration TO viewConfiguration;
ALTER TABLE webknossos.user_dataSetConfigurations RENAME CONSTRAINT configurationIsJsonObject TO viewConfigurationIsJsonObject;

UPDATE webknossos.releaseInformation SET schemaVersion = 57;

COMMIT TRANSACTION;
