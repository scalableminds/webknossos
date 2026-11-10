START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 190 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Sorts digit sequences by their numeric value (e.g. ds2 before ds10). Case is only a tie-breaker.
CREATE COLLATION webknossos.natural_sort (provider = icu, locale = 'en-u-kn-true');

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
