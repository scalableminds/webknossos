-- https://github.com/scalableminds/webknossos/pull/X

START TRANSACTION;
ALTER TABLE webknossos.analytics
  ADD CONSTRAINT valueIsJsonObject CHECK(jsonb_typeof(value) = 'object');
ALTER TABLE webknossos.annotations
  ADD CONSTRAINT statisticsIsJsonObject CHECK(jsonb_typeof(statistics) = 'object');
ALTER TABLE webknossos.dataSets
  ADD CONSTRAINT defaultConfigurationIsJsonObject CHECK(jsonb_typeof(defaultConfiguration) = 'object'),
  ADD CONSTRAINT detailsIsJsonObject CHECK(jsonb_typeof(details) = 'object');
ALTER TABLE webknossos.taskTypes
  ADD CONSTRAINT recommendedConfigurationIsJsonObject CHECK(jsonb_typeof(recommendedConfiguration) = 'object');
ALTER TABLE webknossos.users
  ADD CONSTRAINT userConfigurationIsJsonObject CHECK(jsonb_typeof(userConfiguration) = 'object');
ALTER TABLE webknossos.user_dataSetConfigurations
  ADD CONSTRAINT configurationIsJsonObject CHECK(jsonb_typeof(configuration) = 'object');
COMMIT TRANSACTION;
