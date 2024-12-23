START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 116, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations ADD COLUMN overTimeMailingList VARCHAR(512) NOT NULL DEFAULT '';

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 115;

COMMIT TRANSACTION;
