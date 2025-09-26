START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 143, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- 1. Drop the new organization_usedStorage tables
DROP TABLE IF EXISTS webknossos.organization_usedStorage_mags;
DROP TABLE IF EXISTS webknossos.organization_usedStorage_attachments;

-- 2. Recreate the old organization_usedStorage
CREATE TABLE webknossos.organization_usedStorage(
  _organization TEXT NOT NULL,
  _dataStore TEXT NOT NULL,
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  magOrDirectoryName TEXT NOT NULL,
  usedStorageBytes BIGINT NOT NULL,
  lastUpdated TIMESTAMPTZ,
  PRIMARY KEY(_organization, _dataStore, _dataset, layerName, magOrDirectoryName)
);

-- 3. Reset all storage scan timestamps to fill the new webknossos.organization_usedStorage table
UPDATE webknossos.organizations
SET lastStorageScanTime = '1970-01-01T00:00:00.000Z'
WHERE _id IS NULL;

-- 4. Revert schema version
UPDATE webknossos.releaseInformation SET schemaVersion = 142;

COMMIT TRANSACTION;
