START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 123, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.datasets_;

UPDATE webknossos.datasets SET displayName = name WHERE displayName IS NULL;
ALTER TABLE webknossos.datasets RENAME COLUMN name TO directoryName;
ALTER TABLE webknossos.datasets RENAME COLUMN displayName TO name;
ALTER TABLE webknossos.datasets ALTER COLUMN name SET NOT NULL;

ALTER TABLE webknossos.datasets DROP CONSTRAINT IF EXISTS datasets_name__organization_key;
ALTER TABLE webknossos.datasets ADD CONSTRAINT datasets_directoryName__organization_key UNIQUE(directoryName, _organization);
DROP INDEX webknossos.datasets_name_idx;
CREATE INDEX ON webknossos.datasets(directoryName);

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 124;

COMMIT TRANSACTION;
