START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 113, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations DROP COLUMN overTimeMailingList;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 114;

COMMIT TRANSACTION;
