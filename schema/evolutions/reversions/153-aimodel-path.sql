START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 153 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.aiModels_;

ALTER TABLE webknossos.aiModels DROP COLUMN path;
ALTER TABLE webknossos.aiModels DROP COLUMN uploadToPathIsPending;

CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 152;

COMMIT TRANSACTION;
