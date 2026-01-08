-- Note that this reversion can only be performed if there is still a 1:1 relation between multiUsers and users

START TRANSACTION;

DROP VIEW webknossos.users_;
DROP VIEW webknossos.multiUsers_;
DROP VIEW webknossos.invites_;

ALTER TABLE webknossos.users ADD COLUMN
  email VARCHAR(512) UNIQUE CHECK (email ~* '^.+@.+$');
ALTER TABLE webknossos.users ADD COLUMN
  loginInfo_providerID webknossos.USER_LOGININFO_PROVDERIDS NOT NULL DEFAULT 'credentials';
ALTER TABLE webknossos.users ADD COLUMN
  loginInfo_providerKey VARCHAR(512);
ALTER TABLE webknossos.users ADD COLUMN
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt';
ALTER TABLE webknossos.users ADD COLUMN
  passwordInfo_password VARCHAR(512);
ALTER TABLE webknossos.users ADD COLUMN
  isSuperUser BOOLEAN NOT NULL DEFAULT false;

UPDATE webknossos.users
SET
  email = m.email,
  loginInfo_providerKey = m.email,
  passwordInfo_hasher = m.passwordInfo_hasher,
  passwordInfo_password = m.passwordInfo_password,
  isSuperUser = m.isSuperUser
FROM (SELECT _id, email, passwordInfo_hasher, passwordInfo_password, isSuperUser
      FROM webknossos.multiUsers) AS m
WHERE webknossos.users._multiUser = m._id;

ALTER TABLE webknossos.users ALTER COLUMN email SET NOT NULL;
ALTER TABLE webknossos.users ALTER COLUMN loginInfo_providerKey SET NOT NULL;
ALTER TABLE webknossos.users ALTER COLUMN passwordInfo_password SET NOT NULL;
ALTER TABLE webknossos.users DROP COLUMN _multiUser;

DROP TABLE webknossos.invites;

-- Access tokens now have to be linked to user via email instead of id
UPDATE webknossos.tokens SET logininfo_providerkey = u.email
FROM (SELECT _id, email FROM webknossos.users) AS u
WHERE webknossos.tokens.logininfo_providerkey = u._id;

CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 59;

COMMIT TRANSACTION;
