START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 120, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

UPDATE webknossos.datasets SET displayName = name WHERE displayName IS NULL;
ALTER TABLE webknossos.datasets RENAME COLUMN name TO path;
ALTER TABLE webknossos.datasets RENAME COLUMN displayName TO name;
ALTER TABLE webknossos.datasets ALTER COLUMN name SET NOT NULL;


UPDATE webknossos.releaseInformation SET schemaVersion = 121;

COMMIT TRANSACTION;
