START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 130, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- No reversion for this evolution

UPDATE webknossos.releaseInformation SET schemaVersion = 129;

COMMIT TRANSACTION;
