BEGIN transaction;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.dataStores_;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.dataStores ADD COLUMN reportUsedStorageEnabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webknossos.organizations ADD COLUMN lastStorageScanTime TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

CREATE TABLE webknossos.organization_usedStorage(
  _organization CHAR(24) NOT NULL,
  _dataStore VARCHAR(256) NOT NULL,
  _dataSet CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  magOrDirectoryName VARCHAR(256) NOT NULL,
  usedStorageBytes BIGINT NOT NULL,
  lastUpdated TIMESTAMPTZ,
  PRIMARY KEY(_organization, _dataStore, _dataSet, layerName, magOrDirectoryName)
);

-- recreate dropped views
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 96;

COMMIT;
