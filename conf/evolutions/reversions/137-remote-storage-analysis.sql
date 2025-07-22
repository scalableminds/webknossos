START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 137, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- 1. Drop the new organization_usedStorage table
DROP TABLE IF EXISTS webknossos.organization_usedStorage;

-- 2. Recreate the old version of organization_usedStorage
CREATE TABLE webknossos.organization_usedStorage (
  _organization TEXT NOT NULL,
  _dataStore TEXT NOT NULL,
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  magOrDirectoryName TEXT NOT NULL,
  usedStorageBytes BIGINT NOT NULL,
  lastUpdated TIMESTAMPTZ,
  PRIMARY KEY (_organization, _dataStore, _dataset, layerName, magOrDirectoryName)
);

-- 3. Drop `_id` column from dataset_layer_attachments
ALTER TABLE webknossos.dataset_layer_attachments
  DROP COLUMN IF EXISTS _id;

-- 4. Drop `_id` column from dataset_mags
ALTER TABLE webknossos.dataset_mags
  DROP COLUMN IF EXISTS _id;

-- 5. Reset all storage scan timestamps to fill the new webknossos.organization_usedStorage table
UPDATE webknossos.organizations
SET lastStorageScanTime = '1970-01-01T00:00:00.000Z'
WHERE _id IS NULL;

-- 5. Revert schema version
UPDATE webknossos.releaseInformation SET schemaVersion = 136;

COMMIT TRANSACTION;
