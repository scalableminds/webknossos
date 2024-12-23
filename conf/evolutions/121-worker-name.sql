START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 120, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.workers_;

ALTER TABLE webknossos.workers ADD COLUMN name VARCHAR(256) NOT NULL DEFAULT 'Unnamed Worker';

CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 121;

COMMIT TRANSACTION;
