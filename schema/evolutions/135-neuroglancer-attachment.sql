START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 134, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TYPE webknossos.LAYER_ATTACHMENT_DATAFORMAT ADD VALUE 'neuroglancerPrecomputed';

UPDATE webknossos.releaseInformation SET schemaVersion = 135;

COMMIT TRANSACTION;
