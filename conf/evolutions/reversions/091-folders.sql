BEGIN transaction;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.folders_;
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.dataSets DROP COLUMN _folder;
ALTER TABLE webknossos.organizations DROP COLUMN _rootFolder;

DROP TABLE webknossos.folder_paths;
DROP TABLE webknossos.folder_allowedTeams;
DROP TABLE webknossos.folders;

CREATE VIEW webknossos.datasets_ as SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ as SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 90;

COMMIT;

