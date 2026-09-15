START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 179 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.organization_planExpiryReminders;

UPDATE webknossos.releaseInformation SET schemaVersion = 178;

COMMIT TRANSACTION;
