START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 151 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.aiModels_;

ALTER TABLE webknossos.aiModels ADD COLUMN path TEXT;
ALTER TABLE webknossos.aiModels ADD COLUMN uploadToPathIsPending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 152;

COMMIT TRANSACTION;
