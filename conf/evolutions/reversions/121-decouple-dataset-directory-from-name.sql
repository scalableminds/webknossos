START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 121, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.datasets_;

ALTER TABLE webknossos.datasets RENAME COLUMN name TO displayName;
ALTER TABLE webknossos.datasets RENAME COLUMN path TO name;
ALTER TABLE webknossos.datasets ALTER COLUMN displayName DROP NOT NULL;

ALTER TABLE webknossos.datasets DROP CONSTRAINT IF EXISTS datasets_path__organization_key;
ALTER TABLE webknossos.datasets ADD CONSTRAINT datasets_name__organization_key UNIQUE(name, _organization);
DROP INDEX webknossos.datasets_path_idx;
CREATE INDEX ON webknossos.datasets(name);

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 120;

COMMIT TRANSACTION;
