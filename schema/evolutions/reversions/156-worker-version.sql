START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 156 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.workers_;

ALTER TABLE webknossos.workers DROP COLUMN lastReportedVersion;

CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 155;

COMMIT TRANSACTION;
