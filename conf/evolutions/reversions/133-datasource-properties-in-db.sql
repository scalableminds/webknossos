START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 133, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE webknossos.dataset_layers
  DROP COLUMN IF EXISTS numChannels,
  DROP COLUMN IF EXISTS dataFormat;

DROP TYPE IF EXISTS webknossos.DATASET_LAYER_DATAFORMAT;

ALTER TABLE webknossos.dataset_mags
  DROP COLUMN IF EXISTS credentialId,
  DROP COLUMN IF EXISTS axisOrder,
  DROP COLUMN IF EXISTS channelIndex,
  DROP COLUMN IF EXISTS cubeLength;

UPDATE webknossos.releaseInformation SET schemaVersion = 132;

COMMIT TRANSACTION;
