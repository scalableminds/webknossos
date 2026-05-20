START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 161 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE IF NOT EXISTS 'em_generic';
ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE IF NOT EXISTS 'em_somata';
ALTER TYPE webknossos.AI_MODEL_CATEGORY ADD VALUE IF NOT EXISTS 'em_mitochondria';

-- Commit here because ALTER TYPE cannot run in same transaction as table modifications using the new values
COMMIT TRANSACTION;

START TRANSACTION;

DROP VIEW webknossos.aiModels_;

ALTER TABLE webknossos.aiModels ADD COLUMN isSuperUserOnly BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webknossos.aiModels ADD COLUMN isPretrained BOOLEAN NOT NULL DEFAULT FALSE;

CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 162;

COMMIT TRANSACTION;
