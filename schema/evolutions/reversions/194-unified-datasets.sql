START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 194 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.dataset_layer_origins;

DROP VIEW webknossos.datasets_;

ALTER TABLE webknossos.datasets DROP COLUMN _annotation;
ALTER TABLE webknossos.datasets DROP COLUMN _copiedFrom;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 193;

COMMIT TRANSACTION;
