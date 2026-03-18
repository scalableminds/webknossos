START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 158 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;


DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.users_;
DROP VIEW webknossos.multiUsers_;

ALTER TABLE webknossos.users ADD COLUMN firstName TEXT;
ALTER TABLE webknossos.users ADD COLUMN lastName TEXT;

UPDATE webknossos.users u
SET firstName = m.firstName, lastName = m.lastName
FROM webknossos.multiUsers m
WHERE u._multiUser = m._id;

ALTER TABLE webknossos.users ALTER COLUMN firstName SET NOT NULL;
ALTER TABLE webknossos.users ALTER COLUMN lastName SET NOT NULL;

ALTER TABLE webknossos.multiUsers DROP COLUMN firstName;
ALTER TABLE webknossos.multiUsers DROP COLUMN lastName;

CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, m.firstName, m.lastName, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 157;

COMMIT TRANSACTION;
