START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 138, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores ADD COLUMN allowsManualUpload BOOLEAN NOT NULL DEFAULT TRUE;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 139;

COMMIT TRANSACTION;
