START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 190 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.aiModels_;
DROP VIEW webknossos.partners_;

ALTER TABLE webknossos.organizations DROP COLUMN _partner;
ALTER TABLE webknossos.aiModels DROP COLUMN _partner;
ALTER TABLE webknossos.aiModels DROP COLUMN thumbnailUrl;

DROP TABLE webknossos.partners;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, m.firstName, m.lastName, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 189;

COMMIT TRANSACTION;
