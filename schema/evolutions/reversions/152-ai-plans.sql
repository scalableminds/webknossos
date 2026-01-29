START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 152 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations DROP COLUMN aiPlan;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

DROP TYPE webknossos.AI_PLANS AS ENUM ('Team_AI', 'Power_AI');

UPDATE webknossos.releaseInformation SET schemaVersion = 151;

COMMIT TRANSACTION;
