START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 169 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.datasets_;

ALTER TABLE webknossos.datasets DROP COLUMN datasourcePropertiesPath;
ALTER TABLE webknossos.datasets DROP COLUMN mirrorPath;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 168;

COMMIT TRANSACTION;
