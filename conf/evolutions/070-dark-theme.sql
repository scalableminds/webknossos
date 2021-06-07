-- https://github.com/scalableminds/webknossos/pull/5407

START TRANSACTION;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.multiUsers_;

CREATE TYPE webknossos.THEME AS ENUM ('light', 'dark', 'auto');
ALTER TABLE webknossos.multiUsers ADD COLUMN selectedTheme webknossos.THEME NOT NULL DEFAULT 'auto';

CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;

-- identical to previous (has to be dropped first because of the dependency)
CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;


UPDATE webknossos.releaseInformation SET schemaVersion = 70;

COMMIT TRANSACTION;
