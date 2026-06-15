START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 170 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs DROP COLUMN latestRunErrorDetails;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 169;

COMMIT TRANSACTION;
