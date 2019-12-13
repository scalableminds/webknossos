-- https://github.com/scalableminds/webknossos/pull/4357

START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets DROP COLUMN sourceDefaultConfiguration;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

ALTER TABLE webknossos.dataSets DROP CONSTRAINT sourceDefaultConfigurationIsJsonObject;

ALTER TABLE webknossos.dataSet_layers DROP COLUMN defaultViewConfiguration;
ALTER TABLE webknossos.dataSet_layers DROP CONSTRAINT defaultViewConfigurationIsJsonObject;

UPDATE webknossos.releaseInformation SET schemaVersion = 50;

COMMIT TRANSACTION;
