START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 130, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TABLE webknossos.dataset_special_files(
   _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
   path TEXT NOT NULL,
   type TEXT NOT NULL,
   layerName TEXT
);

UPDATE webknossos.releaseInformation SET schemaVersion = 129;

COMMIT TRANSACTION;
