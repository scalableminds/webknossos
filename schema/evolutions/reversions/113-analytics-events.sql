START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 113, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.analyticsEvents;

UPDATE webknossos.releaseInformation SET schemaVersion = 112;

COMMIT TRANSACTION;
