START TRANSACTION;

UPDATE webknossos.tasktypes SET recommendedconfiguration = recommendedconfiguration - 'highlightHoveredCellId';

UPDATE webknossos.releaseInformation SET schemaVersion = 75;

COMMIT TRANSACTION;
