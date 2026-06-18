START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 171 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- the forward migration only removed an attribute from a JSON object, which is not explicitly mapped to any table column
-- and therefore not preserved in the backward migration


UPDATE webknossos.releaseInformation SET schemaVersion = 170;

COMMIT TRANSACTION;
