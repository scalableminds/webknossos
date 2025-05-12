START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 131, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- The aim of this migration is to have all properties of datasources that are saved in the datasource-properties.json
-- file to be saved in the database.

ALTER TABLE webknossos.dataset_layers
  ADD COLUMN IF NOT EXISTS numChannels INT,
  ADD COLUMN IF NOT EXISTS dataFormat TEXT;

ALTER TABLE webknossos.dataset_mags
  ADD COLUMN IF NOT EXISTS credentialId TEXT,
  ADD COLUMN IF NOT EXISTS axisOrder TEXT,
  ADD COLUMN IF NOT EXISTS channelIndex INT,
  ADD COLUMN IF NOT EXISTS cubeLength INT; -- only for wkw datasets
  -- legacy credentials omitted

UPDATE webknossos.releaseInformation SET schemaVersion = 132;

COMMIT TRANSACTION;
