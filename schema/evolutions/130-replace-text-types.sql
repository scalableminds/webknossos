do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 129, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- Replaces all columns with types CHAR or VARCHAR with TEXT
-- Since doing this for all columns in one transactions takes a significant time,
-- we do this in multiple transactions. Each transaction is for a single table.
-- Since both the previous types and TEXT are handled as variable-length strings
-- in the backend, a partial completion of this script will not cause any issues.



START TRANSACTION;
DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN _task SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _task_objectId CHECK (_task ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN _publication SET DATA TYPE TEXT;
-- Dropped because there are publication ids that are not valid objectIds
-- ALTER TABLE webknossos.annotations ADD CONSTRAINT _publication_objectId CHECK (_publication ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotations ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotations ALTER COLUMN name SET DEFAULT ''::TEXT;
ALTER TABLE webknossos.annotations ALTER COLUMN tags SET DATA TYPE TEXT[];
ALTER TABLE webknossos.annotations ALTER COLUMN tags SET DEFAULT '{}'::TEXT[];
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.annotation_layers ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_layers ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_layers ALTER COLUMN tracingId SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_layers ALTER COLUMN name SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.annotation_sharedTeams ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_sharedTeams ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_sharedTeams ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_sharedTeams ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.annotation_contributors ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_contributors ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_contributors ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_contributors ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.annotation_mutexes ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_mutexes ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_mutexes ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_mutexes ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.meshes_;
ALTER TABLE webknossos.meshes ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.meshes ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.meshes ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.meshes ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.meshes_ AS SELECT * FROM webknossos.meshes WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.publications_;
ALTER TABLE webknossos.publications ALTER COLUMN _id SET DATA TYPE TEXT;
-- Dropped because there are publication ids that are not valid objectIds
--ALTER TABLE webknossos.publications ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.publications ALTER COLUMN imageUrl SET DATA TYPE TEXT;
ALTER TABLE webknossos.publications ALTER COLUMN title SET DATA TYPE TEXT;
CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.datasets ALTER COLUMN _dataStore SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN _publication SET DATA TYPE TEXT;
-- Dropped because there are publication ids that are not valid objectIds
--ALTER TABLE webknossos.datasets ADD CONSTRAINT _publication_objectId CHECK (_publication ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.datasets ALTER COLUMN _uploader SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ADD CONSTRAINT _uploader_objectId CHECK (_uploader ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.datasets ALTER COLUMN _folder SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ADD CONSTRAINT _folder_objectId CHECK (_folder ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.datasets ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN directoryName SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN status SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN status SET DEFAULT ''::TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN sharingToken SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN logoUrl SET DATA TYPE TEXT;
ALTER TABLE webknossos.datasets ALTER COLUMN tags SET DATA TYPE TEXT[];
ALTER TABLE webknossos.datasets ALTER COLUMN tags SET DEFAULT '{}'::TEXT[];
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_layers ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layers ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_layers ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layers ALTER COLUMN mappings SET DATA TYPE TEXT[];
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_layer_coordinateTransformations ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layer_coordinateTransformations ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_layer_coordinateTransformations ALTER COLUMN layerName SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layer_coordinateTransformations ALTER COLUMN type SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_layer_additionalAxes ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layer_additionalAxes ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_layer_additionalAxes ALTER COLUMN layerName SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_layer_additionalAxes ALTER COLUMN name SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_allowedTeams ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_allowedTeams ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_allowedTeams ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_allowedTeams ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_mags ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_mags ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_mags ALTER COLUMN dataLayerName SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_lastUsedTimes ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_lastUsedTimes ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_lastUsedTimes ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_lastUsedTimes ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.dataset_thumbnails ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_thumbnails ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.dataset_thumbnails ALTER COLUMN dataLayerName SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_thumbnails ALTER COLUMN mappingName SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataset_thumbnails ALTER COLUMN mimetype SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.dataStores_;
ALTER TABLE webknossos.dataStores ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataStores ALTER COLUMN url SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataStores ALTER COLUMN publicUrl SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataStores ALTER COLUMN key SET DATA TYPE TEXT;
ALTER TABLE webknossos.dataStores ALTER COLUMN onlyAllowedOrganization SET DATA TYPE TEXT;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.tracingStores_;
ALTER TABLE webknossos.tracingStores ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.tracingStores ALTER COLUMN url SET DATA TYPE TEXT;
ALTER TABLE webknossos.tracingStores ALTER COLUMN publicUrl SET DATA TYPE TEXT;
ALTER TABLE webknossos.tracingStores ALTER COLUMN key SET DATA TYPE TEXT;
CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.projects_;
ALTER TABLE webknossos.projects ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.projects ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.projects ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.projects ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.projects ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.projects ALTER COLUMN _owner SET DATA TYPE TEXT;
ALTER TABLE webknossos.projects ADD CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.projects ALTER COLUMN name SET DATA TYPE TEXT;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.scripts_;
ALTER TABLE webknossos.scripts ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.scripts ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.scripts ALTER COLUMN _owner SET DATA TYPE TEXT;
ALTER TABLE webknossos.scripts ADD CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.scripts ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.scripts ALTER COLUMN gist SET DATA TYPE TEXT;
CREATE VIEW webknossos.scripts_ AS SELECT * FROM webknossos.scripts WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.taskTypes ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.taskTypes ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.taskTypes ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.taskTypes ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.taskTypes ALTER COLUMN summary SET DATA TYPE TEXT;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.tasks ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tasks ALTER COLUMN _project SET DATA TYPE TEXT;
ALTER TABLE webknossos.tasks ADD CONSTRAINT _project_objectId CHECK (_project ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tasks ALTER COLUMN _script SET DATA TYPE TEXT;
ALTER TABLE webknossos.tasks ADD CONSTRAINT _script_objectId CHECK (_script ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tasks ALTER COLUMN _taskType SET DATA TYPE TEXT;
ALTER TABLE webknossos.tasks ADD CONSTRAINT _taskType_objectId CHECK (_taskType ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tasks ALTER COLUMN neededExperience_domain SET DATA TYPE TEXT;
ALTER TABLE webknossos.tasks ALTER COLUMN creationInfo SET DATA TYPE TEXT;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.experienceDomains ALTER COLUMN domain SET DATA TYPE TEXT;
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizationTeams;
ALTER TABLE webknossos.teams ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.teams ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.teams ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.teams ALTER COLUMN name SET DATA TYPE TEXT;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.timespans_;
ALTER TABLE webknossos.timespans ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.timespans ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.timespans ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.timespans ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.timespans ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.timespans ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.timespans_ AS SELECT * FROM webknossos.timespans WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ALTER COLUMN _id_old SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ADD CONSTRAINT _id_old_objectId CHECK (_id_old ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.organizations ALTER COLUMN _id_old SET DEFAULT NULL;
ALTER TABLE webknossos.organizations ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ALTER COLUMN additionalInformation SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ALTER COLUMN additionalInformation SET DEFAULT '';
ALTER TABLE webknossos.organizations ALTER COLUMN logoUrl SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ALTER COLUMN logoUrl SET DEFAULT '';
ALTER TABLE webknossos.organizations ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ALTER COLUMN name SET DEFAULT '';
ALTER TABLE webknossos.organizations ALTER COLUMN _rootFolder SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ADD CONSTRAINT _rootFolder_objectId CHECK (_rootFolder ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.organizations ALTER COLUMN newUserMailingList SET DATA TYPE TEXT;
ALTER TABLE webknossos.organizations ALTER COLUMN newUserMailingList SET DEFAULT '';
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o._id AS organization_id, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN _dataStore SET DATA TYPE TEXT;
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.organization_usedStorage ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN layerName SET DATA TYPE TEXT;
ALTER TABLE webknossos.organization_usedStorage ALTER COLUMN magOrDirectoryName SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.users ALTER COLUMN _multiUser SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ADD CONSTRAINT _multiUser_objectId CHECK (_multiUser ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.users ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ALTER COLUMN firstName SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ALTER COLUMN lastName SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ALTER COLUMN lastTaskTypeId SET DATA TYPE TEXT;
ALTER TABLE webknossos.users ADD CONSTRAINT lastTaskTypeId_objectId CHECK (lastTaskTypeId ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.users ALTER COLUMN lastTaskTypeId SET DEFAULT NULL;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o._id AS organization_id, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.user_team_roles ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_team_roles ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.user_team_roles ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_team_roles ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.user_experiences ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_experiences ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.user_experiences ALTER COLUMN domain SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.user_datasetConfigurations ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_datasetConfigurations ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.user_datasetConfigurations ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_datasetConfigurations ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.user_datasetLayerConfigurations ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_datasetLayerConfigurations ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.user_datasetLayerConfigurations ALTER COLUMN _dataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.user_datasetLayerConfigurations ADD CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.user_datasetLayerConfigurations ALTER COLUMN layerName SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.multiUsers_;
ALTER TABLE webknossos.multiUsers ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.multiUsers ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.multiUsers ALTER COLUMN email SET DATA TYPE TEXT;
ALTER TABLE webknossos.multiUsers ALTER COLUMN passwordInfo_password SET DATA TYPE TEXT;
ALTER TABLE webknossos.multiUsers ALTER COLUMN _lastLoggedInIdentity SET DATA TYPE TEXT;
ALTER TABLE webknossos.multiUsers ADD CONSTRAINT _lastLoggedInIdentity_objectId CHECK (_lastLoggedInIdentity ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.multiUsers ALTER COLUMN _lastloggedinidentity SET DEFAULT NULL;
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o._id AS organization_id, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.tokens_;
ALTER TABLE webknossos.tokens ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.tokens ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.tokens ALTER COLUMN loginInfo_providerKey SET DATA TYPE TEXT;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.maintenances_;
ALTER TABLE webknossos.maintenances ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.maintenances ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.maintenances ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.maintenances ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.maintenances_ as SELECT * FROM webknossos.maintenances WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.workers_;
ALTER TABLE webknossos.workers ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.workers ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.workers ALTER COLUMN _dataStore SET DATA TYPE TEXT;
ALTER TABLE webknossos.workers ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.workers ALTER COLUMN name SET DEFAULT 'Unnamed Worker'::text;
ALTER TABLE webknossos.workers ALTER COLUMN key SET DATA TYPE TEXT;
ALTER TABLE webknossos.workers ALTER COLUMN supportedJobCommands SET DATA TYPE TEXT[];
ALTER TABLE webknossos.workers ALTER COLUMN supportedjobcommands SET DEFAULT array[]::TEXT[];
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.jobs_;
ALTER TABLE webknossos.jobs ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.jobs ALTER COLUMN _owner SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ADD CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.jobs ALTER COLUMN _dataStore SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ALTER COLUMN command SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ALTER COLUMN _worker SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ADD CONSTRAINT _worker_objectId CHECK (_worker ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.jobs ALTER COLUMN _voxelytics_workflowHash SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ALTER COLUMN latestRunId SET DATA TYPE TEXT;
ALTER TABLE webknossos.jobs ALTER COLUMN returnValue SET DATA TYPE TEXT;
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.invites_;
ALTER TABLE webknossos.invites ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.invites ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.invites ALTER COLUMN _organization SET DATA TYPE TEXT;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.annotation_privateLinks_;
ALTER TABLE webknossos.annotation_privateLinks ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_privateLinks ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_privateLinks ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.annotation_privateLinks ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.annotation_privateLinks ALTER COLUMN accessToken SET DATA TYPE TEXT;
CREATE VIEW webknossos.annotation_privateLinks_ as SELECT * FROM webknossos.annotation_privateLinks WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.shortLinks ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.shortLinks ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.shortLinks ALTER COLUMN key SET DATA TYPE TEXT;
ALTER TABLE webknossos.shortLinks ALTER COLUMN longLink SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.credentials_;
ALTER TABLE webknossos.credentials ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.credentials ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.credentials ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.credentials ALTER COLUMN identifier SET DATA TYPE TEXT;
ALTER TABLE webknossos.credentials ALTER COLUMN secret SET DATA TYPE TEXT;
ALTER TABLE webknossos.credentials ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.credentials ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.credentials ALTER COLUMN _organization SET DATA TYPE TEXT;
CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.folders_;
ALTER TABLE webknossos.folders ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.folders ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.folder_paths ALTER COLUMN _ancestor SET DATA TYPE TEXT;
ALTER TABLE webknossos.folder_paths ADD CONSTRAINT _ancestor_objectId CHECK (_ancestor ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.folder_paths ALTER COLUMN _descendant SET DATA TYPE TEXT;
ALTER TABLE webknossos.folder_paths ADD CONSTRAINT _descendant_objectId CHECK (_descendant ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.folder_allowedTeams ALTER COLUMN _folder SET DATA TYPE TEXT;
ALTER TABLE webknossos.folder_allowedTeams ADD CONSTRAINT _folder_objectId CHECK (_folder ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.folder_allowedTeams ALTER COLUMN _team SET DATA TYPE TEXT;
ALTER TABLE webknossos.folder_allowedTeams ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.emailVerificationKeys ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.emailVerificationKeys ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.emailVerificationKeys ALTER COLUMN email SET DATA TYPE TEXT;
ALTER TABLE webknossos.emailVerificationKeys ALTER COLUMN _multiUser SET DATA TYPE TEXT;
ALTER TABLE webknossos.emailVerificationKeys ADD CONSTRAINT _multiUser_objectId CHECK (_multiUser ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.aiModels_;
ALTER TABLE webknossos.aiModels ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiModels ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ALTER COLUMN _dataStore SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiModels ALTER COLUMN _trainingJob SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT _trainingJob_objectId CHECK (_trainingJob ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiModels ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModels ALTER COLUMN comment SET DATA TYPE TEXT;
CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.aiModel_organizations ALTER COLUMN _aiModel SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModel_organizations ADD CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiModel_organizations ALTER COLUMN _organization SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.aiModel_trainingAnnotations ALTER COLUMN _aiModel SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModel_trainingAnnotations ADD CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiModel_trainingAnnotations ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiModel_trainingAnnotations ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.aiInferences_;
ALTER TABLE webknossos.aiInferences ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiInferences ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ALTER COLUMN _aiModel SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiInferences ALTER COLUMN _newDataset SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT _newDataset_objectId CHECK (_newDataset ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiInferences ALTER COLUMN _annotation SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiInferences ALTER COLUMN _inferenceJob SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ADD CONSTRAINT _inferenceJob_objectId CHECK (_inferenceJob ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.aiInferences ALTER COLUMN newSegmentationLayerName SET DATA TYPE TEXT;
ALTER TABLE webknossos.aiInferences ALTER COLUMN maskAnnotationLayerName SET DATA TYPE TEXT;
CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_artifacts ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifacts ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_artifacts ALTER COLUMN _task SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifacts ADD CONSTRAINT _task_objectId CHECK (_task ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_artifacts ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifacts ALTER COLUMN path SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifacts ALTER COLUMN version SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN username SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN hostname SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN voxelyticsVersion SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN workflow_hash SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runs ALTER COLUMN workflow_yamlContent SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_tasks ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_tasks ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_tasks ALTER COLUMN _run SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_tasks ADD CONSTRAINT _run_objectId CHECK (_run ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_tasks ALTER COLUMN name SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_tasks ALTER COLUMN task SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_chunks ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_chunks ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_chunks ALTER COLUMN _task SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_chunks ADD CONSTRAINT _task_objectId CHECK (_task ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_chunks ALTER COLUMN executionId SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_chunks ALTER COLUMN chunkName SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN hash SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_workflows ALTER COLUMN name SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_runHeartbeatEvents ALTER COLUMN _run SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_runHeartbeatEvents ADD CONSTRAINT _run_objectId CHECK (_run ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_chunkProfilingEvents ALTER COLUMN _chunk SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_chunkProfilingEvents ADD CONSTRAINT _chunk_objectId CHECK (_chunk ~ '^[0-9a-f]{24}$');
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ALTER COLUMN _artifact SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ADD CONSTRAINT _artifact_objectId CHECK (_artifact ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ALTER COLUMN path SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ALTER COLUMN resolvedPath SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ALTER COLUMN checksumMethod SET DATA TYPE TEXT;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents ALTER COLUMN checksum SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.analyticsEvents ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN eventType SET DATA TYPE TEXT;
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _user SET DATA TYPE TEXT;
ALTER TABLE webknossos.analyticsEvents ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.analyticsEvents ALTER COLUMN webknossosUri SET DATA TYPE TEXT;
COMMIT TRANSACTION;

START TRANSACTION;
DROP VIEW webknossos.credit_transactions_;
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _id SET DATA TYPE TEXT;
ALTER TABLE webknossos.credit_transactions ADD CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _organization SET DATA TYPE TEXT;
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _related_transaction SET DATA TYPE TEXT;
ALTER TABLE webknossos.credit_transactions ADD CONSTRAINT _related_transaction_objectId CHECK (_related_transaction ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _related_transaction SET DEFAULT NULL;
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _paid_job SET DATA TYPE TEXT;
ALTER TABLE webknossos.credit_transactions ADD CONSTRAINT _paid_job_objectId CHECK (_paid_job ~ '^[0-9a-f]{24}$');
ALTER TABLE webknossos.credit_transactions ALTER COLUMN _paid_job SET DEFAULT NULL;
CREATE VIEW webknossos.credit_transactions_ as SELECT * FROM webknossos.credit_transactions WHERE NOT is_deleted;
COMMIT TRANSACTION;

-- This function used varchar in organization_id, recreate it with TEXT
CREATE OR REPLACE FUNCTION webknossos.hand_out_monthly_free_credits(free_credits_amount DECIMAL) RETURNS VOID AS $$
DECLARE
    organization_id TEXT;
    next_month_first_day DATE;
    existing_transaction_count INT;
BEGIN
    -- Calculate the first day of the next month
    next_month_first_day := DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH';

    -- Loop through all organizations
    FOR organization_id IN (SELECT _id FROM webknossos.organizations) LOOP
        -- Check if there is already a free credit transaction for this organization in the current month
        SELECT COUNT(*) INTO existing_transaction_count
        FROM webknossos.credit_transactions
        WHERE _organization = organization_id
          AND DATE_TRUNC('MONTH', expiration_date) = next_month_first_day;

        -- Insert free credits only if no record exists for this month
        IF existing_transaction_count = 0 THEN
            INSERT INTO webknossos.credit_transactions
                (_id, _organization, credit_delta, comment, transaction_state, credit_state, expiration_date)
            VALUES
                (webknossos.generate_object_id(), organization_id, free_credits_amount,
                 'Free credits for this month', 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

UPDATE webknossos.releaseInformation SET schemaVersion = 130;
