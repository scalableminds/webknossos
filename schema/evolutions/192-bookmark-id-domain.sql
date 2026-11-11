START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.ANNOTATION_ID_DOMAIN ADD VALUE IF NOT EXISTS 'Bookmark';

UPDATE webknossos.releaseInformation SET schemaVersion = 192;

COMMIT TRANSACTION;
