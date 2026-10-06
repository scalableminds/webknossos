START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Drop dependent views
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;

-- Add the Open_Source and Enterprise plans and replace Custom by Enterprise.
-- Recreates the enum type, since Postgres cannot drop a value from an enum, by temporarily casting to text.
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan DROP DEFAULT;
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan TYPE VARCHAR(255);
ALTER TABLE webknossos.organization_plan_updates ALTER COLUMN pricingPlan TYPE VARCHAR(255);
UPDATE webknossos.organizations SET pricingPlan = 'Enterprise' WHERE pricingPlan = 'Custom';
UPDATE webknossos.organization_plan_updates SET pricingPlan = 'Enterprise' WHERE pricingPlan = 'Custom';
DROP TYPE webknossos.PRICING_PLANS;
CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Personal', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Open_Source', 'Enterprise');
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING pricingPlan::webknossos.PRICING_PLANS;
ALTER TABLE webknossos.organizations ALTER COLUMN pricingPlan SET DEFAULT 'Enterprise'::webknossos.PRICING_PLANS;
ALTER TABLE webknossos.organization_plan_updates ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING pricingPlan::webknossos.PRICING_PLANS;

-- Recreate views
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, m.firstName, m.lastName, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
