START TRANSACTION;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.multiUsers_;


ALTER TABLE webknossos.multiusers ADD isEmailVerified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE webknossos.emailVerificationKeys(
                                               _id CHAR(24) PRIMARY KEY,
                                               key TEXT NOT NULL,
                                               email VARCHAR(512) NOT NULL,
                                               _multiUser CHAR(24) NOT NULL,
                                               validUntil TIMESTAMPTZ,
                                               isUsed BOOLEAN NOT NULL DEFAULT false
);

-- Set email verified for all currently registered users (only require email verification for new users)
UPDATE webknossos.multiUsers SET isEmailVerified = true;

-- Recreate views
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o.name AS organization_name, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 105;

COMMIT TRANSACTION;
