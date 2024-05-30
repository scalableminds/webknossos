START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 114, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD isLockedByOwner BOOLEAN NOT NULL DEFAULT FALSE;
CREATE VIEW webknossos.annotations_ as SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 115;

COMMIT TRANSACTION;
