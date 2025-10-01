START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 142, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE IF EXISTS webknossos.organization_usedStorage;

CREATE TABLE webknossos.organization_usedStorage_mags (
    _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
    layerName TEXT NOT NULL,
    mag TEXT NOT NULL, -- Could also go for webknossos.VECTOR3, but would make things maybe a little more complicated
    path TEXT NOT NULL,
    _organization TEXT NOT NULL,
    usedStorageBytes BIGINT NOT NULL CHECK (usedStorageBytes >= 0),
    lastUpdated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (_dataset, layerName, mag),
    CONSTRAINT mags_ref FOREIGN KEY (_dataset, layerName, mag) REFERENCES webknossos.dataset_mags(_dataset, dataLayerName, mag) ON DELETE CASCADE DEFERRABLE
);

CREATE TABLE webknossos.organization_usedStorage_attachments (
    _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
    layerName TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type webknossos.LAYER_ATTACHMENT_TYPE NOT NULL,
    _organization TEXT NOT NULL,
    usedStorageBytes BIGINT NOT NULL CHECK (usedStorageBytes >= 0),
    lastUpdated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (_dataset, layerName, name, type),
    CONSTRAINT attachments__ref FOREIGN KEY (_dataset, layerName, name, type) REFERENCES webknossos.dataset_layer_attachments(_dataset, layerName, name, type) ON DELETE CASCADE DEFERRABLE
);

-- Reset all storage scan timestamps to fill the new webknossos.organization_usedStorage table
UPDATE webknossos.organizations
SET lastStorageScanTime = '1970-01-01T00:00:00.000Z'
WHERE isDeleted IS FALSE;


UPDATE webknossos.releaseInformation SET schemaVersion = 143;

COMMIT TRANSACTION;
