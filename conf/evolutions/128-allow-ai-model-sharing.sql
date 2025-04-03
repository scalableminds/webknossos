START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 127, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.aiModels_;


CREATE TABLE webknossos.aiModel_organizations(
  _aiModel CHAR(24) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  PRIMARY KEY(_aiModel, _organization)
);
ALTER TABLE webknossos.aiModel_organizations
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 128;

COMMIT TRANSACTION;
