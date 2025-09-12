START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 139, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores ADD COLUMN allowsManualUpload BOOLEAN NOT NULL DEFAULT TRUE;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;


ALTER TABLE webknossos.dataset_layer_attachments ADD COLUMN manualUploadIsPending BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE webknossos.releaseInformation SET schemaVersion = 140;

COMMIT TRANSACTION;
