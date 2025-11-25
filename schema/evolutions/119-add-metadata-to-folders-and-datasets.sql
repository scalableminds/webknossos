START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 118, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.folders_;
DROP VIEW webknossos.datasets_;

-- Folder part
ALTER TABLE webknossos.folders ADD COLUMN metadata JSONB NOT NULL DEFAULT '[]';
ALTER TABLE webknossos.folders ADD CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array');

-- Dataset part
ALTER TABLE webknossos.datasets ADD COLUMN metadata JSONB NOT NULL DEFAULT '[]';
ALTER TABLE webknossos.datasets ADD CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array');
-- Add existing details on species to metadata
UPDATE webknossos.datasets
SET metadata = CASE
    WHEN details->>'species' IS NOT NULL THEN
        metadata || jsonb_build_array(
            jsonb_build_object(
                'type', 'string',
                'key', 'species',
                'value', details->>'species'
            )
        )
    ELSE
        metadata
END;
-- Add existing details on brain region to metadata
UPDATE webknossos.datasets
SET metadata = CASE
    WHEN details->>'brainRegion' IS NOT NULL THEN
        metadata || jsonb_build_array(
            jsonb_build_object(
                'type', 'string',
                'key', 'brainRegion',
                'value', details->>'brainRegion'
            )
        )
    ELSE
        metadata
END;

-- Add existing details on acquisition to metadata
UPDATE webknossos.datasets
SET metadata = CASE
    WHEN details->>'acquisition' IS NOT NULL THEN
        metadata || jsonb_build_array(
            jsonb_build_object(
                'type', 'string',
                'key', 'acquisition',
                'value', details->>'acquisition'
            )
        )
    ELSE
        metadata
END;

-- Drop details
ALTER TABLE webknossos.datasets DROP COLUMN details;

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
CREATE VIEW webknossos.datasets_ as SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
UPDATE webknossos.releaseInformation SET schemaVersion = 119;

COMMIT TRANSACTION;
