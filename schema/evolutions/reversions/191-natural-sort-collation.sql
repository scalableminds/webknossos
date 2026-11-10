START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP COLLATION webknossos.natural_sort;

UPDATE webknossos.releaseInformation SET schemaVersion = 190;

COMMIT TRANSACTION;
