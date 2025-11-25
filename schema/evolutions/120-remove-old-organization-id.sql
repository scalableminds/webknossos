START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 119, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


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

-- Drop Foreign Key Constraints
ALTER TABLE webknossos.datasets DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.teams DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.users DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.voxelytics_runs DROP CONSTRAINT voxelytics_runs__organization_fkey;
ALTER TABLE webknossos.voxelytics_runs DROP CONSTRAINT voxelytics_runs__organization_workflow_hash_fkey;
ALTER TABLE webknossos.voxelytics_workflows DROP CONSTRAINT voxelytics_workflows__organization_fkey;
ALTER TABLE webknossos.aiModels DROP CONSTRAINT aimodels__organization_fkey;
ALTER TABLE webknossos.aiInferences DROP CONSTRAINT aiinferences__organization_fkey;


-- Update dataset table
ALTER TABLE webknossos.datasets ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.datasets SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update project table
ALTER TABLE webknossos.projects ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.projects SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update taskType table
ALTER TABLE webknossos.taskTypes ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.taskTypes SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update experienceDomain table
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.experienceDomains SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update team table
ALTER TABLE webknossos.teams ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.teams SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update organization_usedStorage table (has no view)
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.organization_usedStorage SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update user table
ALTER TABLE webknossos.users ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.users SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update invite table
ALTER TABLE webknossos.invites ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.invites SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update credential table
ALTER TABLE webknossos.credentials ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.credentials SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update aiModel table
ALTER TABLE webknossos.aiModels ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.aiModels SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update aiInference table
ALTER TABLE webknossos.aiInferences ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.aiInferences SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update voxelytics_run table
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.voxelytics_runs SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update voxelytics_workflows
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.voxelytics_workflows SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update analyticsEvents local event only first
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization TYPE VARCHAR(256);
UPDATE webknossos.analyticsEvents
SET _organization = (
    SELECT o.name
    FROM webknossos.organizations o
    WHERE o._id = webknossos.analyticsEvents._organization
)
-- preventing the update if the organization does not exist for this event.
WHERE EXISTS (
    SELECT 1
    FROM webknossos.organizations
    WHERE _id = webknossos.analyticsEvents._organization
);

-- join events
UPDATE webknossos.analyticsEvents
SET eventProperties = CASE
    WHEN EXISTS (SELECT 1 FROM webknossos.organizations WHERE _id = eventProperties->>'joined_organization_id') THEN
        (SELECT jsonb_build_object('joined_organization_id', name) FROM webknossos.organizations WHERE _id = eventProperties->>'joined_organization_id')
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
            to_jsonb(name)
          )
          FROM webknossos.organizations
          WHERE _id = eventProperties->>'dataset_organization_id'
        )
    ELSE eventProperties
END
WHERE eventType = 'open_dataset' or eventType = 'upload_dataset';



-- update organization table
ALTER TABLE webknossos.organizations RENAME COLUMN _id TO _id_old;
ALTER TABLE webknossos.organizations RENAME COLUMN name TO _id;
ALTER TABLE webknossos.organizations RENAME COLUMN displayName TO name;
-- reusing the already existing index during new index creation
-- refer to https://gist.github.com/scaryguy/6269293?permalink_comment_id=4229697#gistcomment-4229697
ALTER TABLE webknossos.organizations RENAME CONSTRAINT organizations_pkey TO organizations_pkeyold;
CREATE UNIQUE INDEX organizations_pkey ON webknossos.organizations (_id);
ALTER TABLE webknossos.organizations DROP CONSTRAINT organizations_pkeyold;
ALTER TABLE webknossos.organizations ADD PRIMARY KEY USING INDEX organizations_pkey;

ALTER TABLE webknossos.organizations ALTER COLUMN _id_old TYPE CHAR(24);
ALTER TABLE webknossos.organizations ALTER COLUMN _id_old SET DEFAULT NULL;
ALTER TABLE webknossos.organizations ALTER COLUMN _id_old DROP NOT NULL;
ALTER TABLE webknossos.organizations ALTER COLUMN _id TYPE VARCHAR(256);
ALTER TABLE webknossos.organizations ADD CONSTRAINT validOrganizationId CHECK (_id ~* '^[A-Za-z0-9\-_. ]+$');
-- Drop old unique constraint which is no longer needed as the orga name (now id) is the primary key.
ALTER TABLE webknossos.organizations DROP CONSTRAINT organizations_name_key;



-- Re-add Foreign Key Constraints
ALTER TABLE webknossos.datasets ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.teams ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.users ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.experienceDomains ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runs
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD CONSTRAINT voxelytics_runs__organization_workflow_hash_fkey FOREIGN KEY (_organization, workflow_hash) REFERENCES webknossos.voxelytics_workflows(_organization, hash) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_workflows ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;


-- Recreate views
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.credentials_ AS SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ AS SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;


UPDATE webknossos.releaseInformation SET schemaVersion = 120;

COMMIT TRANSACTION;
