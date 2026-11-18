START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 186 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE INDEX ON webknossos.dataset_layer_coordinateTransformations(_dataset, layerName);
CREATE INDEX ON webknossos.dataset_layer_additionalAxes(_dataset, layerName);

UPDATE webknossos.releaseInformation SET schemaVersion = 187;

COMMIT TRANSACTION;
