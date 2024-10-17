START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 121, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.workers_;

ALTER TABLE webknossos.workers DROP COLUMN name;

CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 120;

COMMIT TRANSACTION;
