START TRANSACTION;

UPDATE webknossos.multiUsers SET novelUserExperienceInfos = novelUserExperienceInfos - 'shouldSeeModernControlsModal';

UPDATE webknossos.releaseInformation SET schemaVersion = 73;

COMMIT TRANSACTION;
