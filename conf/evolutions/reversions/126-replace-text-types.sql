START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- No reversion for this evolution

UPDATE webknossos.releaseInformation SET schemaVersion = 125;

COMMIT TRANSACTION;
