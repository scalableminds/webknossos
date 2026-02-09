START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 152 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;


CREATE TYPE webknossos.AI_PLANS AS ENUM ('Team_AI', 'Power_AI');

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations ADD COLUMN aiPlan webknossos.AI_PLANS DEFAULT NULL;

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


ALTER TABLE webknossos.organization_plan_updates ADD COLUMN aiPlan webknossos.Ai_PLANS DEFAULT NULL;
ALTER TABLE webknossos.organization_plan_updates ADD COLUMN aiPlanChanged BOOLEAN NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 153;

COMMIT TRANSACTION;
