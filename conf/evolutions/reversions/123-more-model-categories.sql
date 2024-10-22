START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 123, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- removing enum values is not supported in postgres, see https://www.postgresql.org/docs/current/datatype-enum.html#DATATYPE-ENUM-IMPLEMENTATION-DETAILS

UPDATE webknossos.releaseInformation SET schemaVersion = 122;

COMMIT TRANSACTION;
