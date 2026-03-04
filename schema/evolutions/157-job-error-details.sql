START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 156 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs ADD COLUMN latestRunErrorDetails JSONB;

ALTER TABLE webknossos.jobs ADD CONSTRAINT latestRunErrorDetailsIsJsonObject CHECK(jsonb_typeof(latestRunErrorDetails) = 'object');

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 157;

COMMIT TRANSACTION;
