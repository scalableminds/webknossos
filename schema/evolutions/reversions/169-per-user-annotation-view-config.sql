START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 169 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.user_annotationLayerConfigurations;

-- restore view config column in annotation table
-- migrate owner view config to annotation table

UPDATE webknossos.releaseInformation SET schemaVersion = 168;

COMMIT TRANSACTION;
