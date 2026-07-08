START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 173, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TYPE webknossos.LAYER_ATTACHMENT_TYPE ADD VALUE 'segmentStatistics';

UPDATE webknossos.releaseInformation SET schemaVersion = 174;

COMMIT TRANSACTION;
