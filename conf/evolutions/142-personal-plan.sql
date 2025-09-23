-- https://github.com/scalableminds/webknossos/issues/8951

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 141, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

START TRANSACTION;

-- Drop dependent views
DROP VIEW webknossos.userinfos;
DROP VIEW webknossos.organizations_;

-- Rename Basic to Personal in pricing plans enum.
-- This also updates all existing rows in the organizations table.
ALTER TYPE webknossos.PRICING_PLANS RENAME VALUE 'Basic' TO 'Personal';

-- Update includedUsers for Personal plan
UPDATE webknossos.organizations
SET includedUsers = 1
WHERE pricingplan = 'Personal'::webknossos.PRICING_PLANS
AND (
  SELECT COUNT(*)
  FROM webknossos.users u
  JOIN webknossos.multiUsers m ON u._multiUser = m._id
  WHERE u._organization = webknossos.organizations._id
  AND m.isSuperUser = FALSE
) = 1;

-- Recreate views
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastName, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;


UPDATE webknossos.releaseInformation SET schemaVersion = 142;

COMMIT TRANSACTION;