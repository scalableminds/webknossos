START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 134, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW IF EXISTS webknossos.userInfos;
DROP VIEW IF EXISTS webknossos.multiUsers_;

ALTER TABLE webknossos.multiUsers ADD COLUMN emailChangeDate TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE webknossos.multiUsers SET emailChangeDate = created;

CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 135;

COMMIT TRANSACTION;
