START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Short-lived tokens, handed out to AI agents via the MCP server (see security.ShortLivedTokenService).
ALTER TYPE webknossos.TOKEN_TYPES ADD VALUE IF NOT EXISTS 'ShortLived';

-- userInfos depends on users_, so both views have to be recreated around the column change.
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.users_;

-- Which permissions this user grants to AI agents connecting via the MCP server. Holds a scope expression as
-- understood by security.Scope.Set.parse, i.e. a permission level ("read", "write", "delete", "none") or an
-- explicit list such as "dataset:read,annotation:write".
ALTER TABLE webknossos.users ADD COLUMN mcpAgentScopes TEXT NOT NULL DEFAULT 'write';

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

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
