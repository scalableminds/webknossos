START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 132, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- The aim of this migration is to have all properties of datasources that are saved in the datasource-properties.json
-- file saved in the database.

CREATE TYPE webknossos.DATASET_LAYER_DATAFORMAT AS ENUM ('wkw','zarr','zarr3','n5','neuroglancerPrecomputed');

ALTER TABLE webknossos.dataset_layers
  ADD COLUMN IF NOT EXISTS numChannels INT,
  ADD COLUMN IF NOT EXISTS dataFormat webknossos.DATASET_LAYER_DATAFORMAT;

ALTER TABLE webknossos.dataset_mags
  ADD COLUMN IF NOT EXISTS credentialId TEXT,
  ADD COLUMN IF NOT EXISTS axisOrder JSONB CONSTRAINT axisOrder_requiredKeys CHECK (axisOrder ? 'x' AND axisOrder ? 'y'),
  ADD COLUMN IF NOT EXISTS channelIndex INT,
  ADD COLUMN IF NOT EXISTS cubeLength INT;
  -- legacy credentials omitted

UPDATE webknossos.releaseInformation SET schemaVersion = 133;

COMMIT TRANSACTION;
