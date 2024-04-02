START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 100, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.annotation_mutexes;

UPDATE webknossos.releaseInformation
SET schemaVersion = 99;

COMMIT TRANSACTION;
