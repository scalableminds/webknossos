START TRANSACTION;

UPDATE webknossos.multiUsers
SET novelUserExperienceInfos = jsonb_set(
        novelUserExperienceInfos,
        array['shouldSeeModernControlsModal'],
        to_jsonb('true'::boolean))
WHERE NOT novelUserExperienceInfos ? 'hasSeenModernControlsModal';

UPDATE webknossos.multiUsers SET  novelUserExperienceInfos = novelUserExperienceInfos - 'hasSeenModernControlsModal';

UPDATE webknossos.releaseInformation SET schemaVersion = 73;

COMMIT TRANSACTION;
