-- https://github.com/scalableminds/webknossos/pull/2567

ALTER TABLE webknossos.dataSet_resolutions 
  ALTER COLUMN dataLayerName TYPE VARCHAR(256);
