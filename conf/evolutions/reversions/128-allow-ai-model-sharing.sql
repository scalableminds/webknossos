START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 128, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.aiModel_organizations;
DROP VIEW IF EXISTS webknossos.aiModels_;


ALTER TABLE webknossos.aiModels RENAME COLUMN _owningOrganization TO _organization;
ALTER TABLE webknossos.aiModels RENAME CONSTRAINT owningOrganization_ref TO organization_ref;

CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 127;

COMMIT TRANSACTION;
