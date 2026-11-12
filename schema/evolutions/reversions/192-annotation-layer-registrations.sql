START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 192 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.annotation_layerRegistrations;

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
