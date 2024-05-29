START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 114, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations ADD COLUMN overTimeMailingList VARCHAR(512) NOT NULL DEFAULT '';

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 113;

COMMIT TRANSACTION;
