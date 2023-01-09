START TRANSACTION;

-- nothing to revert

UPDATE webknossos.releaseInformation SET schemaVersion = 94;

COMMIT TRANSACTION;
