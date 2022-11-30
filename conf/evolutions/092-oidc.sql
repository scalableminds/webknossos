BEGIN transaction;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.multiUsers_;

-- Cannot alter enum in transaction block, workaround required
ALTER TABLE webknossos.multiusers ALTER COLUMN passwordInfo_hasher TYPE VARCHAR(255);
ALTER TABLE webknossos.multiusers ALTER COLUMN passwordinfo_hasher SET DEFAULT 'SCrypt';
DROP TYPE IF EXISTS webknossos.USER_PASSWORDINFO_HASHERS;
CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS AS ENUM (
  'SCrypt',
  'Empty'
  );
ALTER TABLE webknossos.multiusers
  ALTER COLUMN passwordInfo_hasher DROP DEFAULT,
  ALTER COLUMN passwordInfo_hasher TYPE webknossos.USER_PASSWORDINFO_HASHERS
    USING (passwordInfo_hasher::text::webknossos.USER_PASSWORDINFO_HASHERS),
  ALTER COLUMN passwordinfo_hasher SET DEFAULT 'SCrypt';

UPDATE webknossos.releaseInformation SET schemaVersion = 92;


-- recreate dropped views
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o.name AS organization_name, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

COMMIT;
