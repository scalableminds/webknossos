START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 136, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.datasets_;
ALTER TABLE webknossos.datasets ADD COLUMN IF NOT EXISTS isVirtual BOOLEAN NOT NULL DEFAULT FALSE;
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;


UPDATE webknossos.releaseInformation SET schemaVersion = 137;

COMMIT TRANSACTION;
