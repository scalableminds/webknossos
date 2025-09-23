-- https://github.com/scalableminds/webknossos/issues/8873

START TRANSACTION;

-- Drop dependent views
DROP VIEW webknossos.userinfos;
DROP VIEW webknossos.organizations_;

-- Rename Personal to Basic
ALTER TYPE webknossos.PRICING_PLANS RENAME TO prizing_plans_old;
CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Basic', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Custom');
ALTER TABLE webknossos.organizations
  ALTER COLUMN pricingPLan DROP DEFAULT,
  ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING
    CASE pricingPlan
      WHEN 'Personal'::webknossos.prizing_plans_old THEN 'Basic'::webknossos.PRICING_PLANS
      WHEN 'Team'::webknossos.prizing_plans_old THEN 'Team'::webknossos.PRICING_PLANS
      WHEN 'Power'::webknossos.prizing_plans_old THEN 'Power'::webknossos.PRICING_PLANS
      WHEN 'Team_Trial'::webknossos.prizing_plans_old THEN 'Team_Trial'::webknossos.PRICING_PLANS
      WHEN 'Power_Trial'::webknossos.prizing_plans_old THEN 'Power_Trial'::webknossos.PRICING_PLANS
      WHEN 'Custom'::webknossos.prizing_plans_old THEN 'Custom'::webknossos.PRICING_PLANS
    END,
  ALTER COLUMN pricingPlan SET DEFAULT 'Custom'::webknossos.PRICING_PLANS;
DROP TYPE webknossos.prizing_plans_old;

-- Revert includedUsers for Basic plan
UPDATE webknossos.organizations
SET includedUsers = 3
WHERE pricingplan = 'Basic'::webknossos.PRICING_PLANS;

-- Recreate views
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


UPDATE webknossos.releaseInformation SET schemaVersion = 141;

COMMIT TRANSACTION;
