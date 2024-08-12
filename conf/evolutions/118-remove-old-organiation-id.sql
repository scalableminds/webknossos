START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 117, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


-- Drop views
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.projects_;
DROP VIEW webknossos.taskTypes_;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.users_;
DROP VIEW webknossos.invites_;
DROP VIEW webknossos.credentials_;
DROP VIEW webknossos.aiModels_;
DROP VIEW webknossos.aiInferences_;
DROP VIEW webknossos.voxelytics_runs;

-- Update dataset table
ALTER TABLE webknossos.datasets ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.datasets SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update project table
ALTER TABLE webknossos.projects ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.projects SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update taskType table
ALTER TABLE webknossos.taskTypes ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.taskTypes SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update experienceDomain table
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.experienceDomains SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update team table
ALTER TABLE webknossos.teams ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.teams SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update organization_usedStorage table (has no view)
ALTER TABLE webknossos.organizations_usedStorage ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.organizations_usedStorage SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- Update user table
ALTER TABLE webknossos.users ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.users SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update invite table
ALTER TABLE webknossos.invites ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.invites SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update credential table
ALTER TABLE webknossos.credentials ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.credentials SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update aiModel table
ALTER TABLE webknossos.aiModels ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.aiModels SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update aiInference table
ALTER TABLE webknossos.aiInferences ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.aiInferences SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update voxelytics_run table
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.voxelytics_runs SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update voxelytics_workflows
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.voxelytics_workflows SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);

-- update analyticsEvents
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization VARCHAR(256) NOT NULL;
UPDATE webknossos.analyticsEvents SET _organization = (SELECT name FROM webknossos.organizations WHERE _id = _organization);
-- TODO: Properly migrate eventProperties -> potentially missing some ids because they might be from remote wks.

-- update organization table
ALTER TABLE webknossos.organizations RENAME COLUMN _id _id_old;
ALTER TABLE webknossos.organizations RENAME COLUMN name _id;
ALTER TABLE webknossos.organizations RENAME COLUMN displayName name;
ALTER TABLE webknossos.organizations ALTER COLUMN _id_old CHAR(24) DEFAULT NULL;
ALTER TABLE webknossos.organizations ALTER _id VARCHAR(256) PRIMARY KEY CHECK (_id ~* '^[A-Za-z0-9\-_. ]+$');


-- Drop views
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.credentials_ AS SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ AS SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;
CREATE VIEW webknossos.voxelytics_runs AS SELECT * FROM webknossos.voxelytics_runs WHERE NOT isDeleted;




UPDATE webknossos.releaseInformation SET schemaVersion = 118;

COMMIT TRANSACTION;
