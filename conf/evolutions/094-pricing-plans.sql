
START TRANSACTION;

ALTER TABLE webknossos.organizations
ADD paidUntil TIMESTAMPTZ DEFAULT NULL,
ADD includedUsers INTEGER DEFAULT NULL,
ADD includedStorage BIGINT DEFAULT NULL;

-- Drop dependent views
DROP VIEW webknossos.userinfos;
DROP VIEW webknossos.organizations_;

-- Edit pricing plans enum
ALTER TYPE webknossos.PRICING_PLANS RENAME TO prizing_plans_old;
CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Basic', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Custom');
ALTER TABLE webknossos.organizations
  ALTER COLUMN pricingPLan DROP DEFAULT,
  ALTER COLUMN pricingPlan TYPE webknossos.PRICING_PLANS USING
    CASE pricingPlan
      WHEN 'Basic'::webknossos.prizing_plans_old THEN 'Basic'::webknossos.PRICING_PLANS
      WHEN 'Premium'::webknossos.prizing_plans_old THEN 'Team'::webknossos.PRICING_PLANS
      WHEN 'Pilot'::webknossos.prizing_plans_old THEN 'Team'::webknossos.PRICING_PLANS
      ELSE 'Custom'::webknossos.PRICING_PLANS
    END,
  ALTER COLUMN pricingPlan SET DEFAULT 'Custom'::webknossos.PRICING_PLANS;
DROP TYPE webknossos.prizing_plans_old;

UPDATE webknossos.organizations SET includedUsers = 3, includedStorage = 5e10 WHERE pricingplan = 'Basic'::webknossos.PRICING_PLANS;
UPDATE webknossos.organizations SET includedUsers = 5, includedStorage = 1e12 WHERE pricingplan = 'Team'::webknossos.PRICING_PLANS;

-- Recreate views
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o.name AS organization_name, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 94;

COMMIT TRANSACTION;
