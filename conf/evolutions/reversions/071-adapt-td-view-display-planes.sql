START TRANSACTION;

-- Update tdViewDisplayPlanes user configuration setting based on its previous value
-- A previous tdViewDisplayPlanes value of "DATA" corresponds to true
-- and a value of "WIREFRAME" or "NONE" corresponds to false

-- For the user configuration
UPDATE webknossos.users
SET userconfiguration = CASE
WHEN jsonb_typeof(userconfiguration->'tdViewDisplayPlanes') = 'string' AND userconfiguration->>'tdViewDisplayPlanes' = 'DATA' THEN jsonb_set(
        userconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('true'::boolean))
ELSE jsonb_set(
        userconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('false'::boolean))
END
WHERE userconfiguration ? 'tdViewDisplayPlanes';

-- For the recommended configuration in task types
UPDATE webknossos.tasktypes
SET recommendedconfiguration = CASE
WHEN jsonb_typeof(recommendedconfiguration->'tdViewDisplayPlanes') = 'string' AND recommendedconfiguration->>'tdViewDisplayPlanes' = 'DATA' THEN jsonb_set(
        recommendedconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('true'::boolean))
ELSE jsonb_set(
        recommendedconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('false'::boolean))
END
WHERE recommendedconfiguration ? 'tdViewDisplayPlanes';

UPDATE webknossos.releaseInformation SET schemaVersion = 70;

COMMIT TRANSACTION;
