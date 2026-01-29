START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 151 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.AI_PLANS AS ENUM ('Team_AI', 'Power_AI');

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations ADD COLUMN aiPlan webknossos.AI_PLANS DEFAULT NULL;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 152;

COMMIT TRANSACTION;
