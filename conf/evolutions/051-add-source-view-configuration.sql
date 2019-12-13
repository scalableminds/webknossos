-- https://github.com/scalableminds/webknossos/pull/4357

START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets ADD COLUMN sourceDefaultConfiguration JSONB;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

ALTER TABLE webknossos.dataSets ADD CONSTRAINT sourceDefaultConfigurationIsJsonObject CHECK(jsonb_typeof(sourceDefaultConfiguration) = 'object');

ALTER TABLE webknossos.dataSet_layers ADD COLUMN defaultViewConfiguration JSONB;
ALTER TABLE webknossos.dataSet_layers ADD CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object');

UPDATE webknossos.releaseInformation SET schemaVersion = 51;

COMMIT TRANSACTION;
