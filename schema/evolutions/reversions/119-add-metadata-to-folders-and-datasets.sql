START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 119, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.folders_;
DROP VIEW webknossos.datasets_;

-- Folder part
ALTER TABLE webknossos.folders DROP COLUMN metadata;

-- Dataset part
ALTER TABLE webknossos.datasets ADD COLUMN details JSONB;
ALTER TABLE webknossos.datasets ADD CONSTRAINT detailsIsJsonObject CHECK(jsonb_typeof(details) = 'object');

-- Add existing info on species of metadata to details
UPDATE webknossos.datasets
SET details = jsonb_set(COALESCE(details, '{}'), '{species}', (
    SELECT to_jsonb(m.value)
    FROM jsonb_to_recordset(metadata) AS m(key text, value text)
    WHERE m.key = 'species'
    LIMIT 1
))
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(metadata) AS m
    WHERE m->>'key' = 'species'
);


-- Add existing info on species of brainRegion to details
UPDATE webknossos.datasets
SET details = jsonb_set(COALESCE(details, '{}'), '{brainRegion}', (
    SELECT to_jsonb(m.value)
    FROM jsonb_to_recordset(metadata) AS m(key text, value text)
    WHERE m.key = 'brainRegion'
    LIMIT 1
))
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(metadata) AS m
    WHERE m->>'key' = 'brainRegion'
);


-- Add existing info on species of acquisition to details
UPDATE webknossos.datasets
SET details = jsonb_set(COALESCE(details, '{}'), '{acquisition}', (
    SELECT to_jsonb(m.value)
    FROM jsonb_to_recordset(metadata) AS m(key text, value text)
    WHERE m.key = 'acquisition'
    LIMIT 1
))
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(metadata) AS m
    WHERE m->>'key' = 'acquisition'
);



-- Drop details
ALTER TABLE webknossos.datasets DROP COLUMN metadata;

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
CREATE VIEW webknossos.datasets_ as SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
UPDATE webknossos.releaseInformation SET schemaVersion = 118;

COMMIT TRANSACTION;
