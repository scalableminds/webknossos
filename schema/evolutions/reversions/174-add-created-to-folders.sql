START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 174 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.folders_;

ALTER TABLE webknossos.folders DROP COLUMN created;

CREATE VIEW webknossos.folders_ AS SELECT * FROM webknossos.folders WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 173;

COMMIT TRANSACTION;
