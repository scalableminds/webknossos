START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 192 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Scoped API tokens, handed out to AI agents via the MCP server (see security.ScopedApiTokenService).
ALTER TYPE webknossos.TOKEN_TYPES ADD VALUE IF NOT EXISTS 'ScopedApi';

-- MCP clients that registered themselves via OAuth Dynamic Client Registration (RFC 7591). Clients identified by a
-- client metadata document instead are not stored. Registrations that never led to a grant are cleaned up.
CREATE TABLE webknossos.oauthClients(
  clientId TEXT PRIMARY KEY,
  clientName TEXT NOT NULL, -- chosen by the client itself, unverified
  redirectUris TEXT[] NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth grants: an MCP client that a user allowed to access WEBKNOSSOS (see oauth.OAuthService). The client is
-- either the URL of its client metadata document, or the id of a registered client (oauthClients).
CREATE TABLE webknossos.oauthGrants(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  clientId TEXT NOT NULL,
  clientName TEXT NOT NULL,
  scopes TEXT NOT NULL, -- as understood by security.Scope.Set.parse, e.g. a permission level such as "write"
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lastUsed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- Only hashes of codes and tokens are stored, so that a database leak does not hand out credentials.
CREATE TABLE webknossos.oauthAuthorizationCodes(
  codeHash TEXT PRIMARY KEY,
  _grant TEXT CONSTRAINT _grant_objectId CHECK (_grant ~ '^[0-9a-f]{24}$') NOT NULL,
  redirectUri TEXT NOT NULL,
  codeChallenge TEXT NOT NULL, -- PKCE, S256
  expirationDateTime TIMESTAMPTZ NOT NULL,
  isUsed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE webknossos.OAUTH_TOKEN_TYPES AS ENUM ('Access', 'Refresh');
CREATE TABLE webknossos.oauthTokens(
  tokenHash TEXT PRIMARY KEY,
  _grant TEXT CONSTRAINT _grant_objectId CHECK (_grant ~ '^[0-9a-f]{24}$') NOT NULL,
  tokenType webknossos.OAUTH_TOKEN_TYPES NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  isUsed BOOLEAN NOT NULL DEFAULT FALSE, -- refresh tokens are rotated, each one can be used once
  created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The grant a scoped API token was issued under. It carries the grant's scopes and is revoked with it.
DROP VIEW webknossos.tokens_;
ALTER TABLE webknossos.tokens
  ADD COLUMN _oauthGrant TEXT CONSTRAINT _oauthGrant_objectId CHECK (_oauthGrant ~ '^[0-9a-f]{24}$') DEFAULT NULL;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;

CREATE VIEW webknossos.oauthGrants_ AS SELECT * FROM webknossos.oauthGrants WHERE NOT isDeleted;

CREATE INDEX ON webknossos.oauthGrants(_user);
-- At most one live grant per user and client, approving a client again updates it (see OAuthGrantDAO.upsertLive).
CREATE UNIQUE INDEX ON webknossos.oauthGrants(_user, clientId) WHERE NOT isDeleted;
CREATE INDEX ON webknossos.oauthAuthorizationCodes(_grant);
CREATE INDEX ON webknossos.oauthTokens(_grant);
CREATE INDEX ON webknossos.oauthTokens(expirationDateTime);
CREATE INDEX ON webknossos.oauthClients(created);
CREATE INDEX ON webknossos.tokens(_oauthGrant);

ALTER TABLE webknossos.oauthGrants
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.oauthAuthorizationCodes
  ADD CONSTRAINT grant_ref FOREIGN KEY(_grant) REFERENCES webknossos.oauthGrants(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.oauthTokens
  ADD CONSTRAINT grant_ref FOREIGN KEY(_grant) REFERENCES webknossos.oauthGrants(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.tokens
  ADD CONSTRAINT oauthGrant_ref FOREIGN KEY(_oauthGrant) REFERENCES webknossos.oauthGrants(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 193;

COMMIT TRANSACTION;
