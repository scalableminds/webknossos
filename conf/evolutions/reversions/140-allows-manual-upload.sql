START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 140, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores DROP COLUMN allowsManualUpload;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;

ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN allowsManualUpload;

UPDATE webknossos.releaseInformation SET schemaVersion = 139;

COMMIT TRANSACTION;
