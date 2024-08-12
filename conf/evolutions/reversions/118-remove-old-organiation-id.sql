START TRANSACTION;

-- Ensure current schema version matches expected value before rollback
DO $$ 
BEGIN 
    ASSERT (SELECT schemaVersion FROM webknossos.releaseInformation) = 118, 'Current schema version mismatch'; 
END; 
$$ LANGUAGE plpgsql;

-- Drop views created by the migration
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

-- Reverse column renaming and type updates in various tables
ALTER TABLE webknossos.organizations RENAME COLUMN name displayName;
ALTER TABLE webknossos.organizations RENAME COLUMN _id name;
ALTER TABLE webknossos.organizations RENAME COLUMN _id_old _id;
ALTER TABLE webknossos.organizations ALTER COLUMN name VARCHAR(256) NOT NULL UNIQUE;
ALTER TABLE webknossos.organizations ALTER COLUMN _id CHAR(24) PRIMARY KEY;

-- Revert the updates made to the _organization column in all affected tables
UPDATE webknossos.datasets SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.datasets ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.projects SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.projects ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.taskTypes SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.taskTypes ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.experienceDomains SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.teams SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.teams ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.organizations_usedStorage SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.organizations_usedStorage ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.users SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.users ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.invites SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.invites ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.credentials SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.credentials ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.aiModels SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.aiModels ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.aiInferences SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.aiInferences ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.voxelytics_runs SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.voxelytics_workflows SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN _organization SET DATA TYPE CHAR(24);

UPDATE webknossos.analyticsEvents SET _organization = (SELECT _id FROM webknossos.organizations WHERE name = _organization);
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization SET DATA TYPE CHAR(24);

-- Recreate the original views
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites;
CREATE VIEW webknossos.credentials_ AS SELECT * FROM webknossos.credentials;
CREATE VIEW webknossos.aiModels_ AS SELECT * FROM webknossos.aiModels;
CREATE VIEW webknossos.aiInferences_ AS SELECT * FROM webknossos.aiInferences;
CREATE VIEW webknossos.voxelytics_runs AS SELECT * FROM webknossos.voxelytics_runs;

-- Revert schema version
UPDATE webknossos.releaseInformation SET schemaVersion = 117;

COMMIT TRANSACTION;
