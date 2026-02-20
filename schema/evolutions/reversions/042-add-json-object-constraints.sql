START TRANSACTION;

ALTER TABLE webknossos.analytics
  DROP CONSTRAINT valueIsJsonObject;
ALTER TABLE webknossos.annotations
  DROP CONSTRAINT statisticsIsJsonObject;
ALTER TABLE webknossos.dataSets
  DROP CONSTRAINT defaultConfigurationIsJsonObject,
  DROP CONSTRAINT detailsIsJsonObject;
ALTER TABLE webknossos.taskTypes
  DROP CONSTRAINT recommendedConfigurationIsJsonObject;
ALTER TABLE webknossos.users
  DROP CONSTRAINT userConfigurationIsJsonObject;
ALTER TABLE webknossos.user_dataSetConfigurations
  DROP CONSTRAINT configurationIsJsonObject;

UPDATE webknossos.tasktypes SET recommendedConfiguration = to_json(recommendedConfiguration::text);
UPDATE webknossos.releaseInformation SET schemaVersion = 41;

COMMIT TRANSACTION;
