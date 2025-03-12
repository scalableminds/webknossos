START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 127, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.aiModels_;

ALTER TABLE webknossos.aiModels RENAME COLUMN _organization TO _owningOrganization;

CREATE TABLE webknossos.aiModel_organizations(
  _aiModel CHAR(24) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  PRIMARY KEY(_aiModel, _organization)
);
ALTER TABLE webknossos.aiModels DROP CONSTRAINT aimodels__organization_name_key;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT aimodels__owningorganization_name_key UNIQUE (_owningOrganization, name);
ALTER TABLE webknossos.aiModels RENAME CONSTRAINT organization_ref TO owningOrganization_ref;
ALTER TABLE webknossos.aiModel_organizations
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

INSERT INTO webknossos.aiModel_organizations (_aiModel, _organization)
SELECT _id, _owningOrganization FROM webknossos.aiModels;

CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 128;

COMMIT TRANSACTION;
