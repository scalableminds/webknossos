START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 179 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.LAYER_ATTACHMENT_TYPE ADD VALUE IF NOT EXISTS 'segmentStatistics';

UPDATE webknossos.releaseInformation SET schemaVersion = 180;

COMMIT TRANSACTION;
