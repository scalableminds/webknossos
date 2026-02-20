START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 104, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.dataSet_thumbnails;

UPDATE webknossos.releaseInformation SET schemaVersion = 103;

COMMIT TRANSACTION;
