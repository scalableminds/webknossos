START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 187 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.users_;

ALTER TABLE webknossos.users DROP COLUMN mcpAgentScopes;

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

-- Clear any rows using the new enum value before removing it
DELETE FROM webknossos.tokens WHERE tokenType = 'ShortLived';

-- Recreate the enum type without the new value by temporarily casting to text
DROP VIEW webknossos.tokens_;
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE VARCHAR(255);
DROP TYPE webknossos.TOKEN_TYPES;
CREATE TYPE webknossos.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword', 'Job');
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE webknossos.TOKEN_TYPES USING tokenType::webknossos.TOKEN_TYPES;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
