-- https://github.com/scalableminds/webknossos/pull/2567

-- UP:

ALTER TABLE webknossos.dataSet_resolutions 
  ALTER COLUMN dataLayerName TYPE VARCHAR(256);

-- DOWN:

ALTER TABLE webknossos.dataSet_resolutions 
  ALTER COLUMN dataLayerName TYPE CHAR(24);