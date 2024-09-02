START TRANSACTION;

-- !Important: Before running this script, ensure that each organization created between migration 120 and this reversion has been manually assigned a unique and valid _id_old value.


-- Ensure current schema version matches expected value before rollback
DO $$ BEGIN ASSERT (SELECT schemaVersion FROM webknossos.releaseInformation) = 120, 'Current schema version mismatch'; END; $$ LANGUAGE plpgsql;

-- Drop views
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.projects_;
DROP VIEW webknossos.taskTypes_;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.organizationTeams;
DROP VIEW webknossos.users_;
DROP VIEW webknossos.invites_;
DROP VIEW webknossos.credentials_;
DROP VIEW webknossos.aiModels_;
DROP VIEW webknossos.aiInferences_;

-- Drop Foreign Key Constraints added by the migration
ALTER TABLE webknossos.datasets DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.teams DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.users DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.voxelytics_runs DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.voxelytics_workflows DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.aiModels DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.aiInferences DROP CONSTRAINT organization_ref;

-- Revert changes to the organization column in various tables
UPDATE webknossos.datasets SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.datasets ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.projects SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.projects ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.taskTypes SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.taskTypes ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.experienceDomains SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.teams SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.teams ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.organization_usedStorage SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.users SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.users ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.invites SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.invites ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.credentials SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.credentials ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.aiModels SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.aiModels ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.aiInferences SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.aiInferences ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.voxelytics_runs SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _organization TYPE CHAR(24);

UPDATE webknossos.voxelytics_workflows SET _organization = (SELECT _id_old FROM webknossos.organizations WHERE _id = _organization);
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN _organization TYPE CHAR(24);

-- Do not alter column type to keep rows that are not migrated back, is still valid.
-- ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization TYPE CHAR(24);
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.analyticsEvents
SET _organization = (
    SELECT o._id_old
    FROM webknossos.organizations o
    WHERE o._id = webknossos.analyticsEvents._organization
)
-- preventing the update if the organization does not exist for this event.
WHERE EXISTS (
    SELECT True
    FROM webknossos.organizations
    WHERE _id = webknossos.analyticsEvents._organization
);

-- join events
UPDATE webknossos.analyticsEvents
SET eventProperties = CASE
    WHEN EXISTS (SELECT True FROM webknossos.organizations WHERE _id = eventProperties->>'joined_organization_id') THEN
        (SELECT jsonb_build_object('joined_organization_id', _id_old) FROM webknossos.organizations WHERE _id = eventProperties->>'joined_organization_id')
    ELSE eventProperties
END
WHERE eventType = 'join_organization';

UPDATE webknossos.analyticsEvents
SET eventProperties = CASE
    WHEN (SELECT True FROM webknossos.organizations WHERE _id = eventProperties->>'dataset_organization_id') THEN
        (
          SELECT jsonb_set(
            eventProperties::jsonb,
            '{dataset_organization_id}',
            to_jsonb(_id_old)
          )
          FROM webknossos.organizations
          WHERE _id = eventProperties->>'dataset_organization_id'
        )
    ELSE eventProperties
END
WHERE eventType = 'open_dataset' or eventType = 'upload_dataset';



-- Revert changes to the organizations table
-- reusing the already existing index during new index creation
-- refer to https://gist.github.com/scaryguy/6269293?permalink_comment_id=4229697#gistcomment-4229697
ALTER TABLE webknossos.organizations RENAME CONSTRAINT organizations_pkey TO organizations_pkeyold;
CREATE UNIQUE INDEX organizations_pkey ON webknossos.organizations (_id_old);
ALTER TABLE webknossos.organizations DROP CONSTRAINT organizations_pkeyold;
ALTER TABLE webknossos.organizations ADD PRIMARY KEY USING INDEX organizations_pkey;

ALTER TABLE webknossos.organizations RENAME COLUMN name TO displayName;
ALTER TABLE webknossos.organizations RENAME COLUMN _id TO name;
ALTER TABLE webknossos.organizations RENAME COLUMN _id_old TO _id;

ALTER TABLE webknossos.organizations ALTER COLUMN _id TYPE CHAR(24);
ALTER TABLE webknossos.organizations ALTER COLUMN _id DROP DEFAULT;
ALTER TABLE webknossos.organizations ALTER COLUMN _id SET NOT NULL;
ALTER TABLE webknossos.organizations ADD CONSTRAINT organizations_name_key UNIQUE (name);
-- Drop newly added constraint for naming restrictions on the now called name column.
ALTER TABLE webknossos.organizations DROP CONSTRAINT validOrganizationId;

-- Recreate original Foreign Key Constraints
ALTER TABLE webknossos.datasets ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.teams ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id)  DEFERRABLE;
ALTER TABLE webknossos.users ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id)  DEFERRABLE;
ALTER TABLE webknossos.experienceDomains ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id)  DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runs ADD CONSTRAINT voxelytics_runs__organization_fkey FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_workflows ADD CONSTRAINT voxelytics_workflows__organization_fkey FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT aimodels__organization_fkey FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT aiinferences__organization_fkey FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

-- Recreate original views
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

-- Revert schema version
UPDATE webknossos.releaseInformation SET schemaVersion = 119;

COMMIT TRANSACTION;
