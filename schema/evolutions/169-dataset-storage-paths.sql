START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 168 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.datasets_;

ALTER TABLE webknossos.datasets ADD COLUMN rootPath TEXT;
ALTER TABLE webknossos.datasets ADD COLUMN rootRealPath TEXT;
ALTER TABLE webknossos.datasets ADD COLUMN mirrorPath TEXT;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 169;

COMMIT TRANSACTION;
