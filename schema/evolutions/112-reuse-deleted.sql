START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 111, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

UPDATE webknossos.teams SET name = CONCAT(name, '.deleted.beforeDeletionSuffix') WHERE isDeleted = TRUE;
UPDATE webknossos.projects SET name = CONCAT(name, '.deleted.beforeDeletionSuffix') WHERE isDeleted = TRUE;
UPDATE webknossos.tasktypes SET summary = CONCAT(summary, '.deleted.beforeDeletionSuffix') WHERE isDeleted = TRUE;

UPDATE webknossos.releaseInformation SET schemaVersion = 112;

COMMIT TRANSACTION;
