START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 186 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.organization_storageWarnings;

UPDATE webknossos.releaseInformation SET schemaVersion = 185;

COMMIT TRANSACTION;
