START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 146 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs DROP COLUMN lastRetry;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
