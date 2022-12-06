BEGIN transaction;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.users_;


ALTER TABLE webknossos.users ADD COLUMN isOrganizationOwner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webknossos.organizations ADD COLUMN lastTermsOfServiceAcceptanceTime TIMESTAMPTZ;
ALTER TABLE webknossos.organizations ADD COLUMN lastTermsOfServiceAcceptanceVersion INT NOT NULL DEFAULT 0;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 93;

COMMIT;

