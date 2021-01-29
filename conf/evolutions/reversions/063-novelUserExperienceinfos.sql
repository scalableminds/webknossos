START TRANSACTION;

DROP VIEW webknossos.multiUsers_;

ALTER TABLE webknossos.multiUsers DROP CONSTRAINT nuxInfoIsJsonObject;

ALTER TABLE webknossos.multiUsers DROP COLUMN novelUserExperienceInfos;

CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 62;

COMMIT TRANSACTION;
