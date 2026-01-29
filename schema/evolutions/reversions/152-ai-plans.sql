START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 152 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations DROP COLUMN aiPlan;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;



ALTER TABLE webknossos.organization_plan_updates DROP COLUMN aiPlan webknossos.Ai_PLANS;
ALTER TABLE webknossos.organization_plan_updates DROP COLUMN aiPlanChanged;

DROP TYPE webknossos.AI_PLANS AS ENUM ('Team_AI', 'Power_AI');

UPDATE webknossos.releaseInformation SET schemaVersion = 151;

COMMIT TRANSACTION;
