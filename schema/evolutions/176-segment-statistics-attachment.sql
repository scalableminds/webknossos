START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 175 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.LAYER_ATTACHMENT_TYPE ADD VALUE 'segmentStatistics';

UPDATE webknossos.releaseInformation SET schemaVersion = 176;

COMMIT TRANSACTION;
