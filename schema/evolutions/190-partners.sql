START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 189 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.aiModels_;

-- Partners co-brand WEBKNOSSOS for the organizations assigned to them.
CREATE TABLE webknossos.partners(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  name TEXT NOT NULL,
  logoUrl TEXT NOT NULL,
  compactLogoUrl TEXT DEFAULT NULL, -- shown where the navbar is collapsed, falls back to logoUrl
  linkUrl TEXT DEFAULT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE webknossos.organizations
  ADD COLUMN _partner TEXT CONSTRAINT _partner_objectId CHECK (_partner ~ '^[0-9a-f]{24}$') DEFAULT NULL;

-- A pretrained model with a _partner is only visible to the organizations assigned to that partner.
ALTER TABLE webknossos.aiModels
  ADD COLUMN _partner TEXT CONSTRAINT _partner_objectId CHECK (_partner ~ '^[0-9a-f]{24}$') DEFAULT NULL;
ALTER TABLE webknossos.aiModels ADD COLUMN thumbnailUrl TEXT DEFAULT NULL;
-- Shown in the model list, but cannot be used for inference yet.
ALTER TABLE webknossos.aiModels ADD COLUMN isComingSoon BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE webknossos.organizations
  ADD CONSTRAINT partner_ref FOREIGN KEY(_partner) REFERENCES webknossos.partners(_id) DEFERRABLE;
ALTER TABLE webknossos.aiModels
  ADD CONSTRAINT partner_ref FOREIGN KEY(_partner) REFERENCES webknossos.partners(_id) DEFERRABLE;

CREATE VIEW webknossos.partners_ AS SELECT * FROM webknossos.partners WHERE NOT isDeleted;
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

UPDATE webknossos.releaseInformation SET schemaVersion = 190;

COMMIT TRANSACTION;
