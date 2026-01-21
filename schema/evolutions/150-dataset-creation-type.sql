START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 149 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.datasets_;

CREATE TYPE webknossos.DATASET_CREATION_TYPE AS ENUM ('Upload', 'DiskScan', 'UploadToPaths', 'ExploreAndAdd', 'Compose');

ALTER TABLE webknossos.datasets ADD COLUMN creationType webknossos.DATASET_CREATION_TYPE;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 150;

COMMIT TRANSACTION;
