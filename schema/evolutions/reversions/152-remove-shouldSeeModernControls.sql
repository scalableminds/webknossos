START TRANSACTION;

UPDATE webknossos.multiUsers m
SET novelUserExperienceInfos = jsonb_set(
        m.novelUserExperienceInfos,
        array['shouldSeeModernControlsModal'],
        to_jsonb('true'::boolean)
    )
WHERE EXISTS (
    SELECT 1
    FROM webknossos.users u
    WHERE u._multiUser = m._id
      AND u.userConfiguration ->> 'useLegacyBindings' = 'true'
);

UPDATE webknossos.releaseInformation SET schemaVersion = 151;

COMMIT TRANSACTION;
