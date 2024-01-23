START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 112, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

UPDATE webknossos.teams SET name = REPLACE(name, '.deleted.beforeDeletionSuffix', '') WHERE isDeleted = TRUE;
UPDATE webknossos.projects SET name = REPLACE(name, '.deleted.beforeDeletionSuffix', '') WHERE isDeleted = TRUE;
UPDATE webknossos.tasktypes SET summary = REPLACE(summary, '.deleted.beforeDeletionSuffix', '') WHERE isDeleted = TRUE;

UPDATE webknossos.releaseInformation SET schemaVersion = 111;

COMMIT TRANSACTION;
