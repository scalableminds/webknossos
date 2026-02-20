START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 150 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.datasets_;

ALTER TABLE webknossos.datasets DROP COLUMN creationType;

DROP TYPE webknossos.DATASET_CREATION_TYPE;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 149;

COMMIT TRANSACTION;
