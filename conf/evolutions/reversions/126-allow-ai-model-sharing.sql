START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.aiModel_organizations;

ALTER TABLE webknossos.aiModels RENAME COLUMN _owningOrganization TO _organization;
ALTER TABLE webknossos.aiModels RENAME CONSTRAINT owningOrganization_ref TO organization_ref;

UPDATE webknossos.releaseInformation SET schemaVersion = 125;

COMMIT TRANSACTION;
