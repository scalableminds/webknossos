START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 138, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- 1. Add `_id` to dataset_layer_attachments
ALTER TABLE webknossos.dataset_layer_attachments
    ADD COLUMN _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') UNIQUE;

-- 2. Populate missing `_id`s in dataset_layer_attachments
UPDATE webknossos.dataset_layer_attachments
SET _id = webknossos.generate_object_id()
WHERE _id IS NULL;

-- 3. Make `_id` column NOT NULL after filling it
ALTER TABLE webknossos.dataset_layer_attachments ALTER COLUMN _id SET NOT NULL;

-- 4. Add `_id` to dataset_mags if it doesn't exist
ALTER TABLE webknossos.dataset_mags
    ADD COLUMN _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') UNIQUE;

-- 5. Populate missing `_id`s in dataset_mags
UPDATE webknossos.dataset_mags
SET _id = webknossos.generate_object_id()
WHERE _id IS NULL;

-- 6. Make `_id` column NOT NULL after filling it
ALTER TABLE webknossos.dataset_mags ALTER COLUMN _id SET NOT NULL;

-- 7. Drop old organization_usedStorage table if it exists
DROP TABLE IF EXISTS webknossos.organization_usedStorage;

-- 8. Create the new organization_usedStorage table
CREATE TABLE webknossos.organization_usedStorage (
   -- Mostly ignored. Just needed because either of (_dataset_mag, _layer_attachment) must be null and part of a primary key can be null.
   id TEXT PRIMARY KEY
     DEFAULT webknossos.generate_object_id()
     CONSTRAINT id_objectId CHECK (id ~ '^[0-9a-f]{24}$'),
   _organization TEXT NOT NULL,
   _dataset      TEXT NOT NULL,
   _dataset_mag TEXT CONSTRAINT _dataset_mag_objectId CHECK (_dataset_mag IS NULL OR _dataset_mag ~ '^[0-9a-f]{24}$'),
   _layer_attachment TEXT CONSTRAINT _layer_attachment_objectId CHECK (_layer_attachment IS NULL OR _layer_attachment ~ '^[0-9a-f]{24}$'),
   path             TEXT    NOT NULL,
   usedStorageBytes BIGINT  NOT NULL,
   lastUpdated      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   CHECK (
       (_dataset_mag IS NOT NULL AND _layer_attachment IS NULL)
       OR
       (_dataset_mag IS NULL AND _layer_attachment IS NOT NULL)
     ),
   CONSTRAINT unique_dataset_mag UNIQUE (_dataset_mag),
   CONSTRAINT unique_layer_attachment UNIQUE (_layer_attachment)
 );

 -- 9.  Create unique indexes for _dataset_mag and _layer_attachment to enforce their uniqueness -> at most one entry per dataset_mag or layer_attachment
 CREATE UNIQUE INDEX _dataset_mag_unique_idx
   ON webknossos.organization_usedStorage(_dataset_mag)
   WHERE _dataset_mag IS NOT NULL;

 CREATE UNIQUE INDEX _layer_attachment_unique_idx
   ON webknossos.organization_usedStorage(_layer_attachment)
   WHERE _layer_attachment IS NOT NULL;

-- 10. Reset all storage scan timestamps to fill the new webknossos.organization_usedStorage table
UPDATE webknossos.organizations
SET lastStorageScanTime = '1970-01-01T00:00:00.000Z'
WHERE _id IS NULL;


UPDATE webknossos.releaseInformation SET schemaVersion = 139;

COMMIT TRANSACTION;
