START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 149 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.aiModels_;

ALTER TABLE webknossos.aiModels DROP COLUMN path;

CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 148;

COMMIT TRANSACTION;
