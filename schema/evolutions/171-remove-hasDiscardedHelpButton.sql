START TRANSACTION;

UPDATE webknossos.multiUsers SET novelUserExperienceInfos = novelUserExperienceInfos - 'hasDiscardedHelpButton';

UPDATE webknossos.releaseInformation SET schemaVersion = 171;

COMMIT TRANSACTION;
