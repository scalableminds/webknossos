START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 115, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations DROP COLUMN isLockedByOwner;
CREATE VIEW webknossos.annotations_ as SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 114;

COMMIT TRANSACTION;
