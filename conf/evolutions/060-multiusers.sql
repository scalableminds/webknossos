-- https://github.com/scalableminds/webknossos/pull/4922

START TRANSACTION;

DROP VIEW webknossos.users_;

CREATE TABLE webknossos.multiUsers(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  email VARCHAR(512) NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt',
  passwordInfo_password VARCHAR(512) NOT NULL,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _lastLoggedInIdentity CHAR(24) DEFAULT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);


ALTER TABLE webknossos.users DROP COLUMN email;
ALTER TABLE webknossos.users DROP COLUMN loginInfo_providerID;
ALTER TABLE webknossos.users DROP COLUMN loginInfo_providerKey;
ALTER TABLE webknossos.users DROP COLUMN passwordInfo_hasher;
ALTER TABLE webknossos.users DROP COLUMN passwordInfo_password;
ALTER TABLE webknossos.users DROP COLUMN isSuperUser;
ALTER TABLE webknossos.users ADD COLUMN _multiUser CHAR(24) NOT NULL;
ALTER TABLE webknossos.users ADD UNIQUE (_multiUser, _organization);

CREATE TABLE webknossos.invites(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  tokenValue Text NOT NULL,
  _organization CHAR(24) NOT NULL,
  autoActivate BOOLEAN NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX ON webknossos.invites(tokenValue);
CREATE INDEX ON webknossos.multiUsers(email);
CREATE INDEX ON webknossos.users(_multiUser);
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;

ALTER TABLE webknossos.multiUsers
  ADD CONSTRAINT lastLoggedInIdentity_ref FOREIGN KEY(_lastLoggedInIdentity) REFERENCES webknossos.users(_id) ON DELETE SET NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 60;

COMMIT TRANSACTION;
