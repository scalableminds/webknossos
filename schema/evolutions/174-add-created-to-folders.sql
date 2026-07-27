START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 173 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.folders_;

ALTER TABLE webknossos.folders ADD COLUMN created TIMESTAMPTZ;
ALTER TABLE webknossos.folders ALTER COLUMN created SET DEFAULT NOW();

CREATE VIEW webknossos.folders_ AS SELECT * FROM webknossos.folders WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 174;

COMMIT TRANSACTION;
