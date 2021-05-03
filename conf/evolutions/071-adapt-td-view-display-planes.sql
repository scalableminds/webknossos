-- https://github.com/scalableminds/webknossos/pull/5440

START TRANSACTION;

-- Update tdViewDisplayPlanes user configuration setting based on its previous value
-- A previous tdViewDisplayPlanes value of true corresponds to the "DATA" enum value
-- and a value of false corresponds to the "WIREFRAME" enum value

-- For the user configuration
UPDATE webknossos.users
SET userconfiguration = CASE
WHEN jsonb_typeof(userconfiguration->'tdViewDisplayPlanes') = 'boolean' AND (userconfiguration->>'tdViewDisplayPlanes')::boolean IS TRUE THEN jsonb_set(
        userconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('DATA'::text))
ELSE jsonb_set(
        userconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('WIREFRAME'::text))
END
WHERE userconfiguration ? 'tdViewDisplayPlanes';

-- For the recommended configuration in task types
UPDATE webknossos.tasktypes
SET recommendedconfiguration = CASE
WHEN jsonb_typeof(recommendedconfiguration->'tdViewDisplayPlanes') = 'boolean' AND (recommendedconfiguration->>'tdViewDisplayPlanes')::boolean IS TRUE THEN jsonb_set(
        recommendedconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('DATA'::text))
ELSE jsonb_set(
        recommendedconfiguration,
        array['tdViewDisplayPlanes'],
        to_jsonb('WIREFRAME'::text))
END
WHERE recommendedconfiguration ? 'tdViewDisplayPlanes';

UPDATE webknossos.releaseInformation SET schemaVersion = 71;

COMMIT TRANSACTION;
