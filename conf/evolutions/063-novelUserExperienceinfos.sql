-- https://github.com/scalableminds/webknossos/pull/5099

START TRANSACTION;

DROP VIEW webknossos.multiUsers_;

ALTER TABLE webknossos.multiUsers ADD COLUMN novelUserExperienceInfos JSONB NOT NULL DEFAULT '{}'::json;

ALTER TABLE webknossos.multiUsers ADD CONSTRAINT nuxInfoIsJsonObject CHECK(jsonb_typeof(novelUserExperienceInfos) = 'object');

CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 63;

COMMIT TRANSACTION;
