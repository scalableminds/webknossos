START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 188 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.ANNOTATION_ID_DOMAIN ADD VALUE IF NOT EXISTS 'Bookmark';

UPDATE webknossos.releaseInformation SET schemaVersion = 189;

COMMIT TRANSACTION;
