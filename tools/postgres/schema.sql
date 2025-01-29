DROP SCHEMA IF EXISTS webknossos CASCADE;
CREATE SCHEMA webknossos;

CREATE TYPE webknossos.VECTOR3 AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION
);
CREATE TYPE webknossos.BOUNDING_BOX AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  width DOUBLE PRECISION,
  height DOUBLE PRECISION,
  depth DOUBLE PRECISION
);

START TRANSACTION;
CREATE TABLE webknossos.releaseInformation (
  schemaVersion BIGINT NOT NULL
);

INSERT INTO webknossos.releaseInformation(schemaVersion) values(126);
COMMIT TRANSACTION;


CREATE TYPE webknossos.ANNOTATION_TYPE AS ENUM ('Task', 'Explorational', 'TracingBase', 'Orphan');
CREATE TYPE webknossos.ANNOTATION_STATE AS ENUM ('Active', 'Finished', 'Cancelled', 'Initializing');
CREATE TYPE webknossos.ANNOTATION_VISIBILITY AS ENUM ('Private', 'Internal', 'Public');
CREATE TABLE webknossos.annotations(
  _id CHAR(24) PRIMARY KEY,
  _dataset CHAR(24) NOT NULL,
  _task CHAR(24),
  _team CHAR(24) NOT NULL,
  _user CHAR(24) NOT NULL,
  _publication CHAR(24),
  description TEXT NOT NULL DEFAULT '',
  visibility webknossos.ANNOTATION_VISIBILITY NOT NULL DEFAULT 'Internal',
  name VARCHAR(256) NOT NULL DEFAULT '',
  viewConfiguration JSONB,
  state webknossos.ANNOTATION_STATE NOT NULL DEFAULT 'Active',
  isLockedByOwner BOOLEAN NOT NULL DEFAULT FALSE,
  tags VARCHAR(256)[] NOT NULL DEFAULT '{}',
  tracingTime BIGINT,
  typ webknossos.ANNOTATION_TYPE NOT NULL,
  othersMayEdit BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CHECK ((typ IN ('TracingBase', 'Task')) = (_task IS NOT NULL))
);


CREATE TYPE webknossos.ANNOTATION_LAYER_TYPE AS ENUM ('Skeleton', 'Volume');
CREATE TABLE webknossos.annotation_layers(
  _annotation CHAR(24) NOT NULL,
  tracingId CHAR(36) NOT NULL UNIQUE,
  typ webknossos.ANNOTATION_LAYER_TYPE NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.\$]+$'),
  statistics JSONB NOT NULL,
  UNIQUE (name, _annotation),
  PRIMARY KEY (_annotation, tracingId),
  CONSTRAINT statisticsIsJsonObject CHECK(jsonb_typeof(statistics) = 'object')
);

CREATE TABLE webknossos.annotation_sharedTeams(
  _annotation CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_annotation, _team)
);

CREATE TABLE webknossos.annotation_contributors(
  _annotation CHAR(24) NOT NULL,
  _user CHAR(24) NOT NULL,
  PRIMARY KEY (_annotation, _user)
);

CREATE TABLE webknossos.annotation_mutexes(
  _annotation CHAR(24) PRIMARY KEY,
  _user CHAR(24) NOT NULL,
  expiry TIMESTAMP NOT NULL
);

CREATE TABLE webknossos.meshes(
  _id CHAR(24) PRIMARY KEY,
  _annotation CHAR(24) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position webknossos.VECTOR3 NOT NULL,
  data TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.publications(
  _id CHAR(24) PRIMARY KEY,
  publicationDate TIMESTAMPTZ,
  imageUrl VARCHAR(2048),
  title VARCHAR(2048),
  description TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.LENGTH_UNIT AS ENUM ('yoctometer', 'zeptometer', 'attometer', 'femtometer', 'picometer', 'nanometer', 'micrometer', 'millimeter', 'centimeter', 'decimeter', 'meter', 'hectometer', 'kilometer', 'megameter', 'gigameter', 'terameter', 'petameter', 'exameter', 'zettameter', 'yottameter', 'angstrom', 'inch', 'foot', 'yard', 'mile', 'parsec');
CREATE TABLE webknossos.datasets(
  _id CHAR(24) PRIMARY KEY,
  _dataStore VARCHAR(256) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  _publication CHAR(24),
  _uploader CHAR(24),
  _folder CHAR(24) NOT NULL,
  inboxSourceHash INT,
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  description TEXT,
  name VARCHAR(256) NOT NULL,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  isUsable BOOLEAN NOT NULL DEFAULT false,
  directoryName VARCHAR(256) NOT NULL,
  voxelSizeFactor webknossos.VECTOR3,
  voxelSizeUnit webknossos.LENGTH_UNIT,
  status VARCHAR(1024) NOT NULL DEFAULT '',
  sharingToken CHAR(256),
  logoUrl VARCHAR(2048),
  sortingKey TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '[]',
  tags VARCHAR(256)[] NOT NULL DEFAULT '{}',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (directoryName, _organization),
  CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object'),
  CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object'),
  CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array')
);

CREATE TYPE webknossos.DATASET_LAYER_CATEGORY AS ENUM ('color', 'mask', 'segmentation');
CREATE TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS AS ENUM ('uint8', 'uint16', 'uint24', 'uint32', 'uint64', 'float', 'double', 'int8', 'int16', 'int32', 'int64');
CREATE TABLE webknossos.dataset_layers(
  _dataset CHAR(24) NOT NULL,
  name VARCHAR(256) NOT NULL,
  category webknossos.DATASET_LAYER_CATEGORY NOT NULL,
  elementClass webknossos.DATASET_LAYER_ELEMENT_CLASS NOT NULL,
  boundingBox webknossos.BOUNDING_BOX NOT NULL,
  largestSegmentId BIGINT,
  mappings VARCHAR(256)[],
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  PRIMARY KEY(_dataset, name),
  CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object'),
  CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object')
);

CREATE TABLE webknossos.dataset_layer_coordinateTransformations(
  _dataset CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  type VARCHAR(256) NOT NULL,
  matrix JSONB,
  correspondences JSONB,
  insertionOrderIndex INT
);

CREATE TABLE webknossos.dataset_layer_additionalAxes(
   _dataset CHAR(24) NOT NULL,
   layerName VARCHAR(256) NOT NULL,
   name VARCHAR(256) NOT NULL,
   lowerBound INT NOT NULL,
   upperBound INT NOT NULL,
   index INT NOT NULL
);

CREATE TABLE webknossos.dataset_allowedTeams(
  _dataset CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_dataset, _team)
);

CREATE TABLE webknossos.dataset_mags(
  _dataset CHAR(24) NOT NULL,
  dataLayerName VARCHAR(256),
  mag webknossos.VECTOR3 NOT NULL,
  PRIMARY KEY (_dataset, dataLayerName, mag)
);

CREATE TABLE webknossos.dataset_lastUsedTimes(
  _dataset CHAR(24) NOT NULL,
  _user CHAR(24) NOT NULL,
  lastUsedTime TIMESTAMPTZ NOT NULL
);

CREATE TABLE webknossos.dataset_thumbnails(
  _dataset CHAR(24) NOT NULL,
  dataLayerName VARCHAR(256),
  width INT NOT NULL,
  height INT NOT NULL,
  mappingName VARCHAR(256) NOT NULL, -- emptystring means no mapping
  image BYTEA NOT NULL,
  mimetype VARCHAR(256),
  mag webknossos.VECTOR3 NOT NULL,
  mag1BoundingBox webknossos.BOUNDING_BOX NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_dataset, dataLayerName, width, height, mappingName)
);

CREATE TYPE webknossos.DATASTORE_TYPE AS ENUM ('webknossos-store');
CREATE TABLE webknossos.dataStores(
  name VARCHAR(256) PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url VARCHAR(512) UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  publicUrl VARCHAR(512) UNIQUE NOT NULL CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$'),
  key VARCHAR(1024) NOT NULL,
  isScratch BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  allowsUpload BOOLEAN NOT NULL DEFAULT true,
  onlyAllowedOrganization CHAR(24),
  reportUsedStorageEnabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.tracingStores(
  name VARCHAR(256) PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url VARCHAR(512) UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  publicUrl VARCHAR(512) UNIQUE NOT NULL CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$'),
  key VARCHAR(1024) NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.projects(
  _id CHAR(24) PRIMARY KEY,
  _organization VARCHAR(256) NOT NULL,
  _team CHAR(24) NOT NULL,
  _owner CHAR(24) NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^.{3,}$'), -- Unique among non-deleted, enforced in scala
  priority BIGINT NOT NULL DEFAULT 100,
  paused BOOLEAN NOT NULL DEFAULT false,
  expectedTime BIGINT,
  isBlacklistedFromReport BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.scripts(
  _id CHAR(24) PRIMARY KEY,
  _owner CHAR(24) NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  gist VARCHAR(1024) NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CHECK (gist ~* '^https?://[a-z0-9\-_\.]+.*$')
);

CREATE TYPE webknossos.TASKTYPE_MODES AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');
CREATE TYPE webknossos.TASKTYPE_TRACINGTYPES AS ENUM ('skeleton', 'volume', 'hybrid');
CREATE TABLE webknossos.taskTypes(
  _id CHAR(24) PRIMARY KEY,
  _organization VARCHAR(256) NOT NULL,
  _team CHAR(24) NOT NULL,
  summary VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  settings_allowedModes webknossos.TASKTYPE_MODES[] NOT NULL DEFAULT '{orthogonal, flight, oblique}',
  settings_preferredMode webknossos.TASKTYPE_MODES DEFAULT 'orthogonal',
  settings_branchPointsAllowed BOOLEAN NOT NULL,
  settings_somaClickingAllowed BOOLEAN NOT NULL,
  settings_volumeInterpolationAllowed BOOLEAN NOT NULL DEFAULT false,
  settings_mergerMode BOOLEAN NOT NULL DEFAULT false,
  settings_magRestrictions_min INT DEFAULT NULL,
  settings_magRestrictions_max INT DEFAULT NULL,
  recommendedConfiguration JSONB,
  tracingType webknossos.TASKTYPE_TRACINGTYPES NOT NULL DEFAULT 'skeleton',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT recommendedConfigurationIsJsonObject CHECK(jsonb_typeof(recommendedConfiguration) = 'object'),
  UNIQUE (summary, _organization)
);

CREATE TABLE webknossos.tasks(
  _id CHAR(24) PRIMARY KEY,
  _project CHAR(24) NOT NULL,
  _script CHAR(24),
  _taskType CHAR(24) NOT NULL,
  neededExperience_domain VARCHAR(256) NOT NULL CHECK (neededExperience_domain ~* '^.{2,}$'),
  neededExperience_value INT NOT NULL,
  totalInstances BIGINT NOT NULL,
  pendingInstances BIGINT NOT NULL,
  tracingTime BIGINT,
  boundingBox webknossos.BOUNDING_BOX,
  editPosition webknossos.VECTOR3 NOT NULL,
  editRotation webknossos.VECTOR3 NOT NULL,
  creationInfo VARCHAR(512),
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT pendingInstancesLargeEnoughCheck CHECK (pendingInstances >= 0)
);

CREATE TABLE webknossos.experienceDomains(
  domain VARCHAR(256) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  CONSTRAINT primarykey__domain_orga PRIMARY KEY (domain,_organization)
);

CREATE TABLE webknossos.teams(
  _id CHAR(24) PRIMARY KEY,
  _organization VARCHAR(256) NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isOrganizationTeam BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (name, _organization)
);

CREATE TABLE webknossos.timespans(
  _id CHAR(24) PRIMARY KEY,
  _user CHAR(24) NOT NULL,
  _annotation CHAR(24),
  time BIGINT NOT NULL,
  lastUpdate TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  numberOfUpdates BIGINT NOT NULL DEFAULT 1,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Basic', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Custom');
CREATE TABLE webknossos.organizations(
  _id_old CHAR(24) DEFAULT NULL,
  _id VARCHAR(256) PRIMARY KEY,
  additionalInformation VARCHAR(2048) NOT NULL DEFAULT '',
  logoUrl VARCHAR(2048) NOT NULL DEFAULT '',
  name VARCHAR(1024) NOT NULL DEFAULT '',
  _rootFolder CHAR(24) NOT NULL UNIQUE,
  newUserMailingList VARCHAR(512) NOT NULL DEFAULT '',
  enableAutoVerify BOOLEAN NOT NULL DEFAULT false,
  pricingPlan webknossos.PRICING_PLANS NOT NULL DEFAULT 'Custom',
  paidUntil TIMESTAMPTZ DEFAULT NULL,
  includedUsers INTEGER DEFAULT NULL,
  includedStorage BIGINT DEFAULT NULL,
  lastTermsOfServiceAcceptanceTime TIMESTAMPTZ,
  lastTermsOfServiceAcceptanceVersion INT NOT NULL DEFAULT 0,
  lastStorageScanTime TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT validOrganizationId CHECK (_id ~* '^[A-Za-z0-9\-_. ]+$')
);

CREATE TABLE webknossos.organization_usedStorage(
  _organization VARCHAR(256) NOT NULL,
  _dataStore VARCHAR(256) NOT NULL,
  _dataset CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  magOrDirectoryName VARCHAR(256) NOT NULL,
  usedStorageBytes BIGINT NOT NULL,
  lastUpdated TIMESTAMPTZ,
  PRIMARY KEY(_organization, _dataStore, _dataset, layerName, magOrDirectoryName)
);

-- Create the enum type for transaction states
CREATE TYPE webknossos.credit_transaction_state AS ENUM ('Pending', 'Completed', 'Refunded', 'Revoked', 'Spent');

-- Create the transactions table
CREATE TABLE webknossos.organization_credit_transactions (
    _id CHAR(24) PRIMARY KEY,
    _organization VARCHAR(256) NOT NULL,
    credit_change DECIMAL(14, 4) NOT NULL,
    spent_money DECIMAL(14, 4),
    comment TEXT NOT NULL,
    _paid_job CHAR(24),
    state webknossos.credit_transaction_state NOT NULL,
    expiration_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS AS ENUM ('SCrypt', 'Empty');
CREATE TABLE webknossos.users(
  _id CHAR(24) PRIMARY KEY,
  _multiUser CHAR(24) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  firstName VARCHAR(256) NOT NULL, -- CHECK (firstName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastName VARCHAR(256) NOT NULL, -- CHECK (lastName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastActivity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  userConfiguration JSONB NOT NULL,
  isDeactivated BOOLEAN NOT NULL DEFAULT false,
  isAdmin BOOLEAN NOT NULL DEFAULT false,
  isOrganizationOwner BOOLEAN NOT NULL DEFAULT false,
  isDatasetManager BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lastTaskTypeId CHAR(24) DEFAULT NULL,
  isUnlisted BOOLEAN NOT NULL DEFAULT FALSE,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (_multiUser, _organization),
  CONSTRAINT userConfigurationIsJsonObject CHECK(jsonb_typeof(userConfiguration) = 'object')
);

CREATE TABLE webknossos.user_team_roles(
  _user CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  isTeamManager BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (_user, _team)
);

CREATE TABLE webknossos.user_experiences(
  _user CHAR(24) NOT NULL,
  domain VARCHAR(256) NOT NULL,
  value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (_user, domain)
);

CREATE TABLE webknossos.user_datasetConfigurations(
  _user CHAR(24) NOT NULL,
  _dataset CHAR(24) NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

CREATE TABLE webknossos.user_datasetLayerConfigurations(
  _user CHAR(24) NOT NULL,
  _dataset CHAR(24) NOT NULL,
  layerName VARCHAR(256) NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset, layerName),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);


CREATE TYPE webknossos.THEME AS ENUM ('light', 'dark', 'auto');
CREATE TABLE webknossos.multiUsers(
  _id CHAR(24) PRIMARY KEY,
  email VARCHAR(512) NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt',
  passwordInfo_password VARCHAR(512) NOT NULL,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  novelUserExperienceInfos JSONB NOT NULL DEFAULT '{}'::json,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selectedTheme webknossos.THEME NOT NULL DEFAULT 'auto',
  _lastLoggedInIdentity CHAR(24) DEFAULT NULL,
  isEmailVerified BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT nuxInfoIsJsonObject CHECK(jsonb_typeof(novelUserExperienceInfos) = 'object')
);


CREATE TYPE webknossos.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword');
CREATE TYPE webknossos.USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');
CREATE TABLE webknossos.tokens(
  _id CHAR(24) PRIMARY KEY,
  value TEXT NOT NULL,
  loginInfo_providerID webknossos.USER_LOGININFO_PROVDERIDS NOT NULL,
  loginInfo_providerKey VARCHAR(512) NOT NULL,
  lastUsedDateTime TIMESTAMPTZ NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  idleTimeout BIGINT,
  tokenType webknossos.TOKEN_TYPES NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.maintenances(
  _id CHAR(24) PRIMARY KEY,
  _user CHAR(24) NOT NULL,
  startTime TIMESTAMPTZ NOT NULL,
  endTime TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.workers(
  _id CHAR(24) PRIMARY KEY,
  _dataStore VARCHAR(256) NOT NULL,
  name VARCHAR(256) NOT NULL DEFAULT 'Unnamed Worker',
  key VARCHAR(1024) NOT NULL UNIQUE,
  maxParallelHighPriorityJobs INT NOT NULL DEFAULT 1,
  maxParallelLowPriorityJobs INT NOT NULL DEFAULT 1,
  supportedJobCommands VARCHAR(256)[] NOT NULL DEFAULT array[]::varchar(256)[],
  lastHeartBeat TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01T00:00:00Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);


CREATE TYPE webknossos.JOB_STATE AS ENUM ('PENDING', 'STARTED', 'SUCCESS', 'FAILURE', 'CANCELLED');

CREATE TABLE webknossos.jobs(
  _id CHAR(24) PRIMARY KEY,
  _owner CHAR(24) NOT NULL,
  _dataStore VARCHAR(256) NOT NULL,
  command TEXT NOT NULL,
  commandArgs JSONB NOT NULL,
  state webknossos.JOB_STATE NOT NULL DEFAULT 'PENDING', -- always updated by the worker
  manualState webknossos.JOB_STATE, -- set by the user or admin
  _worker CHAR(24),
  _voxelytics_workflowHash VARCHAR(512),
  latestRunId VARCHAR(1024),
  returnValue Text,
  started TIMESTAMPTZ,
  ended TIMESTAMPTZ,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);


CREATE TABLE webknossos.invites(
  _id CHAR(24) PRIMARY KEY,
  tokenValue Text NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  autoActivate BOOLEAN NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.annotation_privateLinks(
  _id CHAR(24) PRIMARY KEY,
  _annotation CHAR(24) NOT NULL,
  accessToken Text NOT NULL UNIQUE,
  expirationDateTime TIMESTAMPTZ,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.shortLinks(
  _id CHAR(24) PRIMARY KEY,
  key CHAR(16) NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HttpBasicAuth', 'HttpToken', 'S3AccessKey', 'GoogleServiceAccount');
CREATE TABLE webknossos.credentials(
  _id CHAR(24) PRIMARY KEY,
  type webknossos.CREDENTIAL_TYPE NOT NULL,
  name VARCHAR(256) NOT NULL,
  identifier Text,
  secret Text,
  _user CHAR(24) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.folders(
    _id CHAR(24) PRIMARY KEY,
    name TEXT NOT NULL CHECK (name !~ '/'),
    isDeleted BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB  NOT NULL DEFAULT '[]',
    CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array')
);

CREATE TABLE webknossos.folder_paths(
    _ancestor CHAR(24) NOT NULL,
    _descendant CHAR(24) NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY(_ancestor, _descendant)
);

CREATE TABLE webknossos.folder_allowedTeams(
  _folder CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_folder, _team)
);

CREATE TABLE webknossos.emailVerificationKeys(
  _id CHAR(24) PRIMARY KEY,
  key TEXT NOT NULL,
  email VARCHAR(512) NOT NULL,
  _multiUser CHAR(24) NOT NULL,
  validUntil TIMESTAMPTZ,
  isUsed BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.AI_MODEL_CATEGORY AS ENUM ('em_neurons', 'em_nuclei', 'em_synapses', 'em_neuron_types', 'em_cell_organelles');

CREATE TABLE webknossos.aiModels(
  _id CHAR(24) PRIMARY KEY,
  _organization VARCHAR(256) NOT NULL,
  _dataStore VARCHAR(256) NOT NULL, -- redundant to job, but must be available for jobless models
  _user CHAR(24) NOT NULL,
  _trainingJob CHAR(24),
  name VARCHAR(1024) NOT NULL,
  comment VARCHAR(1024),
  category webknossos.AI_MODEL_CATEGORY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (_organization, name)
);

CREATE TABLE webknossos.aiModel_trainingAnnotations(
  _aiModel CHAR(24) NOT NULL,
  _annotation CHAR(24) NOT NULL,
  PRIMARY KEY(_aiModel,_annotation)
);

CREATE TABLE webknossos.aiInferences(
  _id CHAR(24) PRIMARY KEY,
  _organization VARCHAR(256) NOT NULL,
  _aiModel CHAR(24) NOT NULL,
  _newDataset CHAR(24),
  _annotation CHAR(24),
  _inferenceJob CHAR(24) NOT NULL,
  boundingBox webknossos.BOUNDING_BOX NOT NULL,
  newSegmentationLayerName VARCHAR(256) NOT NULL,
  maskAnnotationLayerName VARCHAR(256),
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE webknossos.VOXELYTICS_RUN_STATE AS ENUM ('PENDING', 'SKIPPED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED', 'STALE');

CREATE TABLE webknossos.voxelytics_artifacts(
    _id CHAR(24) NOT NULL,
    _task CHAR(24) NOT NULL,
    name VARCHAR(512) NOT NULL,
    path TEXT NOT NULL,
    fileSize INT8 NOT NULL,
    inodeCount INT8 NOT NULL,
    version TEXT NOT NULL DEFAULT '0',
    metadata JSONB,
    PRIMARY KEY (_id),
    UNIQUE (_task, name),
    UNIQUE (_task, path),
    CONSTRAINT metadataIsJsonObject CHECK(jsonb_typeof(metadata) = 'object')
);

CREATE TABLE webknossos.voxelytics_runs(
    _id CHAR(24) NOT NULL,
    _organization VARCHAR(256) NOT NULL,
    _user CHAR(24) NOT NULL,
    name VARCHAR(2048) NOT NULL,
    username TEXT NOT NULL,
    hostname TEXT NOT NULL,
    voxelyticsVersion TEXT NOT NULL,
    workflow_hash VARCHAR(512) NOT NULL,
    workflow_yamlContent TEXT,
    workflow_config JSONB,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_organization, name),
    CONSTRAINT workflowConfigIsJsonObject CHECK(jsonb_typeof(workflow_config) = 'object')
);

CREATE TABLE webknossos.voxelytics_tasks(
    _id CHAR(24) NOT NULL,
    _run CHAR(24) NOT NULL,
    name varCHAR(2048) NOT NULL,
    task varCHAR(512) NOT NULL,
    config JSONB NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_run, name),
    CONSTRAINT configIsJsonObject CHECK(jsonb_typeof(config) = 'object')
);

CREATE TABLE webknossos.voxelytics_chunks(
    _id CHAR(24) NOT NULL,
    _task CHAR(24) NOT NULL,
    executionId VARCHAR(2048) NOT NULL,
    chunkName VARCHAR(2048) NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_task, executionId, chunkName)
);

CREATE TABLE webknossos.voxelytics_workflows(
    _organization VARCHAR(256) NOT NULL,
    hash VARCHAR(512) NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (_organization, hash)
);

CREATE TABLE webknossos.voxelytics_runHeartbeatEvents(
    _run CHAR(24) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_run)
);

CREATE TABLE webknossos.voxelytics_chunkProfilingEvents(
    _chunk CHAR(24) NOT NULL,
    hostname TEXT NOT NULL,
    pid INT8 NOT NULL,
    memory FLOAT NOT NULL,
    cpuUser FLOAT NOT NULL,
    cpuSystem FLOAT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_chunk, timestamp)
);

CREATE TABLE webknossos.voxelytics_artifactFileChecksumEvents(
    _artifact CHAR(24) NOT NULL,
    path TEXT NOT NULL,
    resolvedPath TEXT NOT NULL,
    checksumMethod VARCHAR(512) NOT NULL,
    checksum VARCHAR(512) NOT NULL,
    fileSize INT8 NOT NULL,
    lastModified TIMESTAMPTZ NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_artifact, path, timestamp)
);

CREATE TABLE webknossos.analyticsEvents(
  _id CHAR(24) PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessionId BIGINT NOT NULL,
  eventType VARCHAR(512) NOT NULL,
  eventProperties JSONB NOT NULL,
  _user CHAR(24) NOT NULL,
  _organization VARCHAR(256) NOT NULL,
  isOrganizationAdmin BOOLEAN NOT NULL,
  isSuperUser BOOLEAN NOT NULL,
  webknossosUri VARCHAR(512) NOT NULL,
  CONSTRAINT eventProperties CHECK(jsonb_typeof(eventProperties) = 'object')
);


CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;
CREATE VIEW webknossos.meshes_ AS SELECT * FROM webknossos.meshes WHERE NOT isDeleted;
CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;
CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.scripts_ AS SELECT * FROM webknossos.scripts WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.timespans_ AS SELECT * FROM webknossos.timespans WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
CREATE VIEW webknossos.annotation_privateLinks_ as SELECT * FROM webknossos.annotation_privateLinks WHERE NOT isDeleted;
CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
CREATE VIEW webknossos.maintenances_ as SELECT * FROM webknossos.maintenances WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;
CREATE VIEW webknossos.organization_credit_transactions_ as SELECT * FROM webknossos.organization_credit_transactions WHERE NOT is_deleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;


CREATE INDEX ON webknossos.annotations(_user, isDeleted);
CREATE INDEX ON webknossos.annotations(_task, isDeleted);
CREATE INDEX ON webknossos.annotations(typ, state, isDeleted);
CREATE INDEX ON webknossos.annotations(_user, _task, isDeleted);
CREATE INDEX ON webknossos.annotations(_task, typ, isDeleted);
CREATE INDEX ON webknossos.annotations(typ, isDeleted);
CREATE INDEX ON webknossos.datasets(directoryName);
CREATE INDEX ON webknossos.datasets(_folder);
CREATE INDEX ON webknossos.tasks(_project);
CREATE INDEX ON webknossos.tasks(isDeleted);
CREATE INDEX ON webknossos.tasks(_project, isDeleted);
CREATE INDEX ON webknossos.tasks(neededExperience_domain, neededExperience_value);
CREATE INDEX ON webknossos.tasks(_taskType);
CREATE INDEX ON webknossos.timespans(_user);
CREATE INDEX ON webknossos.timespans(_annotation);
CREATE INDEX ON webknossos.users(_multiUser);
CREATE INDEX ON webknossos.multiUsers(email);
CREATE INDEX ON webknossos.projects(name);
CREATE INDEX ON webknossos.projects(_team);
CREATE INDEX ON webknossos.projects(name, isDeleted);
CREATE INDEX ON webknossos.projects(_team, isDeleted);
CREATE INDEX ON webknossos.invites(tokenValue);
CREATE INDEX ON webknossos.annotation_privateLinks(accessToken);
CREATE INDEX ON webknossos.shortLinks(key);
CREATE INDEX ON webknossos.organization_credit_transactions(state);
CREATE INDEX ON webknossos.organization_credit_transactions(expiration_date);

ALTER TABLE webknossos.annotations
  ADD CONSTRAINT task_ref FOREIGN KEY(_task) REFERENCES webknossos.tasks(_id) ON DELETE SET NULL DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) DEFERRABLE,
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) DEFERRABLE,
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES webknossos.publications(_id) DEFERRABLE;
ALTER TABLE webknossos.annotation_sharedTeams
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.annotation_contributors
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.annotation_mutexes
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.meshes
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE;
ALTER TABLE webknossos.datasets
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE,
  ADD CONSTRAINT uploader_ref FOREIGN KEY(_uploader) REFERENCES webknossos.users(_id) DEFERRABLE,
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES webknossos.publications(_id) DEFERRABLE;
ALTER TABLE webknossos.dataset_layers
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.dataset_allowedTeams
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.dataset_mags
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.projects
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) DEFERRABLE,
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id) DEFERRABLE;
ALTER TABLE webknossos.scripts
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id) DEFERRABLE;
ALTER TABLE webknossos.taskTypes
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.tasks
  ADD CONSTRAINT project_ref FOREIGN KEY(_project) REFERENCES webknossos.projects(_id) DEFERRABLE,
  ADD CONSTRAINT script_ref FOREIGN KEY(_script) REFERENCES webknossos.scripts(_id) ON DELETE SET NULL DEFERRABLE;
ALTER TABLE webknossos.teams
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.timespans
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE SET NULL DEFERRABLE;
ALTER TABLE webknossos.users
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.user_team_roles
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.user_experiences
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.user_datasetConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.organization_credit_transactions
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT paid_job_ref FOREIGN KEY(_paid_job) REFERENCES webknossos.jobs(_id) DEFERRABLE;
ALTER TABLE webknossos.user_datasetLayerConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE webknossos.multiUsers
  ADD CONSTRAINT lastLoggedInIdentity_ref FOREIGN KEY(_lastLoggedInIdentity) REFERENCES webknossos.users(_id) ON DELETE SET NULL;
ALTER TABLE webknossos.experienceDomains
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;
ALTER TABLE webknossos.jobs
  ADD CONSTRAINT owner_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id) DEFERRABLE,
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE,
  ADD CONSTRAINT worker_ref FOREIGN KEY(_worker) REFERENCES webknossos.workers(_id) DEFERRABLE;
ALTER TABLE webknossos.workers
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE;
ALTER TABLE webknossos.annotation_privateLinks
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE;
ALTER TABLE webknossos.folder_paths
  ADD FOREIGN KEY (_ancestor) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.folder_paths
  ADD FOREIGN KEY (_descendant) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.organizations
  ADD FOREIGN KEY (_rootFolder) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.dataset_layer_coordinateTransformations
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) DEFERRABLE;
ALTER TABLE webknossos.dataset_layer_additionalAxes
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) DEFERRABLE;
ALTER TABLE webknossos.voxelytics_artifacts
  ADD FOREIGN KEY (_task) REFERENCES webknossos.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runs
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  -- explicit naming for this constraint, as different postgres versions give different names to tuple key constraints
  ADD CONSTRAINT voxelytics_runs__organization_workflow_hash_fkey FOREIGN KEY (_organization, workflow_hash) REFERENCES webknossos.voxelytics_workflows(_organization, hash) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_tasks
  ADD FOREIGN KEY (_run) REFERENCES webknossos.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_chunks
  ADD FOREIGN KEY (_task) REFERENCES webknossos.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_workflows
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_runHeartbeatEvents
  ADD FOREIGN KEY (_run) REFERENCES webknossos.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_chunkProfilingEvents
  ADD FOREIGN KEY (_chunk) REFERENCES webknossos.voxelytics_chunks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.voxelytics_artifactFileChecksumEvents
  ADD FOREIGN KEY (_artifact) REFERENCES webknossos.voxelytics_artifacts(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiModels
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_dataStore) REFERENCES webknossos.datastores(name) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_trainingJob) REFERENCES webknossos.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiInferences
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_newDataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_inferenceJob) REFERENCES webknossos.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiModel_trainingAnnotations
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;


CREATE FUNCTION webknossos.countsAsTaskInstance(a webknossos.annotations) RETURNS BOOLEAN AS $$
  BEGIN
    RETURN (a.state != 'Cancelled' AND a.isDeleted = false AND a.typ = 'Task');
  END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION webknossos.onUpdateTask() RETURNS trigger AS $$
  BEGIN
    IF NEW.totalInstances <> OLD.totalInstances THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances + (NEW.totalInstances - OLD.totalInstances) WHERE _id = NEW._id;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateTaskTrigger
AFTER UPDATE ON webknossos.tasks
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateTask();


CREATE FUNCTION webknossos.onInsertAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW.typ = 'Task') AND (NEW.isDeleted = false) AND (NEW.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onInsertAnnotationTrigger
AFTER INSERT ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onInsertAnnotation();



CREATE OR REPLACE FUNCTION webknossos.onUpdateAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW._task != OLD._task) OR (NEW.typ != OLD.typ) THEN
        RAISE EXCEPTION 'annotation columns _task and typ are immutable';
    END IF;
    IF (webknossos.countsAsTaskInstance(OLD) AND NOT webknossos.countsAsTaskInstance(NEW))
    THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances + 1 WHERE _id = NEW._task;
    END IF;
    IF (NOT webknossos.countsAsTaskInstance(OLD) AND webknossos.countsAsTaskInstance(NEW))
    THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateAnnotationTrigger
AFTER UPDATE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onUpdateAnnotation();


CREATE FUNCTION webknossos.onDeleteAnnotation() RETURNS TRIGGER AS $$
  BEGIN
    IF (OLD.typ = 'Task') AND (OLD.isDeleted = false) AND (OLD.state != 'Cancelled') THEN
      UPDATE webknossos.tasks SET pendingInstances = pendingInstances + 1 WHERE _id = OLD._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onDeleteAnnotationTrigger
AFTER DELETE ON webknossos.annotations
FOR EACH ROW EXECUTE PROCEDURE webknossos.onDeleteAnnotation();

CREATE  FUNCTION webknossos.enforce_non_negative_balance() RETURNS TRIGGER AS $$
  DECLARE
    current_balance DECIMAL(14, 4);
    new_balance DECIMAL(14, 4);
  BEGIN
    -- Calculate the current credit balance for the affected organization
    SELECT COALESCE(SUM(credit_change), 0)
    INTO current_balance
    FROM webknossos.organization_credit_transactions
    WHERE _organization = NEW._organization AND _id != NEW._id;
    -- Add the new transaction's credit change to calculate the new balance
    new_balance := current_balance + COALESCE(NEW.credit_change, 0);
    -- Check if the new balance is negative
    IF new_balance < 0 THEN
        RAISE EXCEPTION 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    END IF;
    -- Allow the transaction
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON webknossos.organization_credit_transactions
FOR EACH ROW EXECUTE PROCEDURE webknossos.enforce_non_negative_balance();


--- Stored procedure to revoke temporary credits from an organization
--- TODO !!!!!! Fix refunded free credits not being revoked !!!!!!
CREATE FUNCTION webknossos.revoke_expired_credits()
RETURNS VOID AS $$
DECLARE
    organization_id VARCHAR(256);
    free_credits_transaction RECORD;
    credits_to_revoke DECIMAL(14, 4) := 0;
    spent_credits_since_then DECIMAL(14, 4) := 0;
    free_credits_spent DECIMAL(14, 4) := 0;
    transaction RECORD;
    revoked_organizations_count INTEGER := 0;
    revoked_credit_count DECIMAL(14, 4) := 0;
BEGIN
    -- Iterate through organizations
    BEGIN
      FOR organization_id IN
          SELECT DISTINCT _organization
          FROM webknossos.organization_credit_transactions
          WHERE expiration_date <= CURRENT_DATE
            AND state = 'Completed'
            AND credit_change > 0
      LOOP
          -- Reset credits to revoke
          credits_to_revoke := 0;
          free_credits_spent := 0;

          -- Iterate through expired credits transactions for this organization starting from the most recent
          FOR free_credits_transaction IN
              SELECT *
              FROM webknossos.organization_credit_transactions
              WHERE _organization = organization_id
                AND expiration_date <= CURRENT_DATE
                AND state = 'Completed'
                AND credit_change > 0
              ORDER BY created_at DESC
          LOOP
              -- Calculate spent credits since the free credit transaction
              SELECT COALESCE(SUM(credit_change), 0)
              INTO spent_credits_since_then
              FROM webknossos.organization_credit_transactions
              WHERE _organization = organization_id
                AND created_at > free_credits_transaction.created_at
                AND credit_change < 0
                AND state = 'Completed';

              -- Spent credits are negative, so we negate them for easier calculation
              spent_credits_since_then := spent_credits_since_then * -1;
              -- Check if the credits have been fully spent
              IF spent_credits_since_then >= (free_credits_transaction.credit_change + free_credits_spent) THEN
                  -- Fully spent, update state to 'SPENT', no need to increase revoked_credit_count
                  free_credits_spent := free_credits_spent + free_credits_transaction.credit_change;
                  UPDATE webknossos.organization_credit_transactions
                  SET state = 'Spent', updated_at = NOW()
                  WHERE id = free_credits_transaction.id;
              ELSE
                  -- Calculate the amount to revoke
                  credits_to_revoke := credits_to_revoke + (free_credits_transaction.credit_change + free_credits_spent - spent_credits_since_then);
                  free_credits_spent := free_credits_spent + spent_credits_since_then;

                  -- Update transaction state to 'REVOKED'
                  UPDATE webknossos.organization_credit_transactions
                  SET state = 'Revoked', updated_at = NOW()
                  WHERE id = free_credits_transaction.id;

                  -- Add the date to the revoked dates set
                  -- (In PostgreSQL, we don't need a set; we will use it for information in the comment)
              END IF;
          END LOOP;

          -- If there are credits to revoke, create a revocation transaction
          IF credits_to_revoke > 0 THEN
              INSERT INTO webknossos.organization_credit_transactions (
                  _organization, credit_change, comment, state, created_at, updated_at
              )
              VALUES (
                  organization_id,
                  -credits_to_revoke,
                  CONCAT('Revoked free credits granted.'),
                  'Completed',
                  CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP
              );
              -- Log the revocation action for this organization
              revoked_credit_count := revoked_credit_count + credits_to_revoke;
              revoked_organizations_count := revoked_organizations_count + 1;
          END IF;

      END LOOP;

      -- Final notice about revoked credits
      RAISE NOTICE 'Revoked temporary credits for % organizations, total credits revoked: %', revoked_organizations_count, revoked_credit_count;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Failed to revoke credits: %', SQLERRM;
        RAISE;
    END;
    COMMIT;
END;
$$ LANGUAGE plpgsql;

-- Schedule the job to run every night at 00:01
-- SELECT cron.schedule('RevokeExpiredCredits', '1 0 * * *', $$CALL webknossos.revoke_expired_credits();$$);

