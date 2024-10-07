START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 120, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.workers ADD COLUMN name VARCHAR(256) NOT NULL DEFAULT 'Unnamed Worker';

UPDATE webknossos.releaseInformation SET schemaVersion = 121;

COMMIT TRANSACTION;
