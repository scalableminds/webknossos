START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 147 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs ADD COLUMN lastRetry TIMESTAMPTZ;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 148;

COMMIT TRANSACTION;
