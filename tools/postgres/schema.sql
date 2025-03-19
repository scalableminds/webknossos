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

INSERT INTO webknossos.releaseInformation(schemaVersion) values(128);
COMMIT TRANSACTION;


CREATE TYPE webknossos.ANNOTATION_TYPE AS ENUM ('Task', 'Explorational', 'TracingBase', 'Orphan');
CREATE TYPE webknossos.ANNOTATION_STATE AS ENUM ('Active', 'Finished', 'Cancelled', 'Initializing');
CREATE TYPE webknossos.ANNOTATION_VISIBILITY AS ENUM ('Private', 'Internal', 'Public');
CREATE TABLE webknossos.annotations(
  _id TEXT PRIMARY KEY,
  _dataset TEXT NOT NULL,
  _task TEXT,
  _team TEXT NOT NULL,
  _user TEXT NOT NULL,
  _publication TEXT,
  description TEXT NOT NULL DEFAULT '',
  visibility webknossos.ANNOTATION_VISIBILITY NOT NULL DEFAULT 'Internal',
  name TEXT NOT NULL DEFAULT '',
  viewConfiguration JSONB,
  state webknossos.ANNOTATION_STATE NOT NULL DEFAULT 'Active',
  isLockedByOwner BOOLEAN NOT NULL DEFAULT FALSE,
  tags TEXT[] NOT NULL DEFAULT '{}',
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
  _annotation TEXT NOT NULL,
  tracingId TEXT NOT NULL UNIQUE,
  typ webknossos.ANNOTATION_LAYER_TYPE NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.\$]+$'),
  statistics JSONB NOT NULL,
  UNIQUE (name, _annotation),
  PRIMARY KEY (_annotation, tracingId),
  CONSTRAINT statisticsIsJsonObject CHECK(jsonb_typeof(statistics) = 'object')
);

CREATE TABLE webknossos.annotation_sharedTeams(
  _annotation TEXT NOT NULL,
  _team TEXT NOT NULL,
  PRIMARY KEY (_annotation, _team)
);

CREATE TABLE webknossos.annotation_contributors(
  _annotation TEXT NOT NULL,
  _user TEXT NOT NULL,
  PRIMARY KEY (_annotation, _user)
);

CREATE TABLE webknossos.annotation_mutexes(
  _annotation TEXT PRIMARY KEY,
  _user TEXT NOT NULL,
  expiry TIMESTAMP NOT NULL
);

CREATE TABLE webknossos.meshes(
  _id TEXT PRIMARY KEY,
  _annotation TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position webknossos.VECTOR3 NOT NULL,
  data TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.publications(
  _id TEXT PRIMARY KEY,
  publicationDate TIMESTAMPTZ,
  imageUrl TEXT,
  title TEXT,
  description TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.LENGTH_UNIT AS ENUM ('yoctometer', 'zeptometer', 'attometer', 'femtometer', 'picometer', 'nanometer', 'micrometer', 'millimeter', 'centimeter', 'decimeter', 'meter', 'hectometer', 'kilometer', 'megameter', 'gigameter', 'terameter', 'petameter', 'exameter', 'zettameter', 'yottameter', 'angstrom', 'inch', 'foot', 'yard', 'mile', 'parsec');
CREATE TABLE webknossos.datasets(
  _id TEXT PRIMARY KEY,
  _dataStore TEXT NOT NULL,
  _organization TEXT NOT NULL,
  _publication TEXT,
  _uploader TEXT,
  _folder TEXT NOT NULL,
  inboxSourceHash INT,
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  description TEXT,
  name TEXT NOT NULL,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  isUsable BOOLEAN NOT NULL DEFAULT false,
  directoryName TEXT NOT NULL,
  voxelSizeFactor webknossos.VECTOR3,
  voxelSizeUnit webknossos.LENGTH_UNIT,
  status TEXT NOT NULL DEFAULT '',
  sharingToken TEXT,
  logoUrl TEXT,
  sortingKey TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] NOT NULL DEFAULT '{}',
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
  _dataset TEXT NOT NULL,
  name TEXT NOT NULL,
  category webknossos.DATASET_LAYER_CATEGORY NOT NULL,
  elementClass webknossos.DATASET_LAYER_ELEMENT_CLASS NOT NULL,
  boundingBox webknossos.BOUNDING_BOX NOT NULL,
  largestSegmentId BIGINT,
  mappings TEXT[],
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  PRIMARY KEY(_dataset, name),
  CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object'),
  CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object')
);

CREATE TABLE webknossos.dataset_layer_coordinateTransformations(
  _dataset TEXT NOT NULL,
  layerName TEXT NOT NULL,
  type TEXT NOT NULL,
  matrix JSONB,
  correspondences JSONB,
  insertionOrderIndex INT
);

CREATE TABLE webknossos.dataset_layer_additionalAxes(
   _dataset TEXT NOT NULL,
   layerName TEXT NOT NULL,
   name TEXT NOT NULL,
   lowerBound INT NOT NULL,
   upperBound INT NOT NULL,
   index INT NOT NULL
);

CREATE TABLE webknossos.dataset_allowedTeams(
  _dataset TEXT NOT NULL,
  _team TEXT NOT NULL,
  PRIMARY KEY (_dataset, _team)
);

CREATE TABLE webknossos.dataset_mags(
  _dataset TEXT NOT NULL,
  dataLayerName TEXT,
  mag webknossos.VECTOR3 NOT NULL,
  path TEXT,
  realPath TEXT,
  hasLocalData BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (_dataset, dataLayerName, mag)
);

CREATE TABLE webknossos.dataset_lastUsedTimes(
  _dataset TEXT NOT NULL,
  _user TEXT NOT NULL,
  lastUsedTime TIMESTAMPTZ NOT NULL
);

CREATE TABLE webknossos.dataset_thumbnails(
  _dataset TEXT NOT NULL,
  dataLayerName TEXT,
  width INT NOT NULL,
  height INT NOT NULL,
  mappingName TEXT NOT NULL, -- emptystring means no mapping
  image BYTEA NOT NULL,
  mimetype TEXT,
  mag webknossos.VECTOR3 NOT NULL,
  mag1BoundingBox webknossos.BOUNDING_BOX NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_dataset, dataLayerName, width, height, mappingName)
);

CREATE TYPE webknossos.DATASTORE_TYPE AS ENUM ('webknossos-store');
CREATE TABLE webknossos.dataStores(
  name TEXT PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url TEXT UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  publicUrl TEXT UNIQUE NOT NULL CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$'),
  key TEXT NOT NULL,
  isScratch BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  allowsUpload BOOLEAN NOT NULL DEFAULT true,
  onlyAllowedOrganization TEXT,
  reportUsedStorageEnabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.tracingStores(
  name TEXT PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url TEXT UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  publicUrl TEXT UNIQUE NOT NULL CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$'),
  key TEXT NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.projects(
  _id TEXT PRIMARY KEY,
  _organization TEXT NOT NULL,
  _team TEXT NOT NULL,
  _owner TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^.{3,}$'), -- Unique among non-deleted, enforced in scala
  priority BIGINT NOT NULL DEFAULT 100,
  paused BOOLEAN NOT NULL DEFAULT false,
  expectedTime BIGINT,
  isBlacklistedFromReport BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.scripts(
  _id TEXT PRIMARY KEY,
  _owner TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  gist TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CHECK (gist ~* '^https?://[a-z0-9\-_\.]+.*$')
);

CREATE TYPE webknossos.TASKTYPE_MODES AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');
CREATE TYPE webknossos.TASKTYPE_TRACINGTYPES AS ENUM ('skeleton', 'volume', 'hybrid');
CREATE TABLE webknossos.taskTypes(
  _id TEXT PRIMARY KEY,
  _organization TEXT NOT NULL,
  _team TEXT NOT NULL,
  summary TEXT NOT NULL,
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
  _id TEXT PRIMARY KEY,
  _project TEXT NOT NULL,
  _script TEXT,
  _taskType TEXT NOT NULL,
  neededExperience_domain TEXT NOT NULL CHECK (neededExperience_domain ~* '^.{2,}$'),
  neededExperience_value INT NOT NULL,
  totalInstances BIGINT NOT NULL,
  pendingInstances BIGINT NOT NULL,
  tracingTime BIGINT,
  boundingBox webknossos.BOUNDING_BOX,
  editPosition webknossos.VECTOR3 NOT NULL,
  editRotation webknossos.VECTOR3 NOT NULL,
  creationInfo TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT pendingInstancesLargeEnoughCheck CHECK (pendingInstances >= 0)
);

CREATE TABLE webknossos.experienceDomains(
  domain TEXT NOT NULL,
  _organization TEXT NOT NULL,
  CONSTRAINT primarykey__domain_orga PRIMARY KEY (domain,_organization)
);

CREATE TABLE webknossos.teams(
  _id TEXT PRIMARY KEY,
  _organization TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isOrganizationTeam BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (name, _organization)
);

CREATE TABLE webknossos.timespans(
  _id TEXT PRIMARY KEY,
  _user TEXT NOT NULL,
  _annotation TEXT,
  time BIGINT NOT NULL,
  lastUpdate TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  numberOfUpdates BIGINT NOT NULL DEFAULT 1,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.PRICING_PLANS AS ENUM ('Basic', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Custom');
CREATE TABLE webknossos.organizations(
  _id_old TEXT DEFAULT NULL,
  _id TEXT PRIMARY KEY,
  additionalInformation TEXT NOT NULL DEFAULT '',
  logoUrl TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  _rootFolder TEXT NOT NULL UNIQUE,
  newUserMailingList TEXT NOT NULL DEFAULT '',
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
  _organization TEXT NOT NULL,
  _dataStore TEXT NOT NULL,
  _dataset TEXT NOT NULL,
  layerName TEXT NOT NULL,
  magOrDirectoryName TEXT NOT NULL,
  usedStorageBytes BIGINT NOT NULL,
  lastUpdated TIMESTAMPTZ,
  PRIMARY KEY(_organization, _dataStore, _dataset, layerName, magOrDirectoryName)
);

CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS AS ENUM ('SCrypt', 'Empty');
CREATE TABLE webknossos.users(
  _id TEXT PRIMARY KEY,
  _multiUser TEXT NOT NULL,
  _organization TEXT NOT NULL,
  firstName TEXT NOT NULL, -- CHECK (firstName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastName TEXT NOT NULL, -- CHECK (lastName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastActivity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  userConfiguration JSONB NOT NULL,
  isDeactivated BOOLEAN NOT NULL DEFAULT false,
  isAdmin BOOLEAN NOT NULL DEFAULT false,
  isOrganizationOwner BOOLEAN NOT NULL DEFAULT false,
  isDatasetManager BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lastTaskTypeId TEXT DEFAULT NULL,
  isUnlisted BOOLEAN NOT NULL DEFAULT FALSE,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (_multiUser, _organization),
  CONSTRAINT userConfigurationIsJsonObject CHECK(jsonb_typeof(userConfiguration) = 'object')
);

CREATE TABLE webknossos.user_team_roles(
  _user TEXT NOT NULL,
  _team TEXT NOT NULL,
  isTeamManager BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (_user, _team)
);

CREATE TABLE webknossos.user_experiences(
  _user TEXT NOT NULL,
  domain TEXT NOT NULL,
  value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (_user, domain)
);

CREATE TABLE webknossos.user_datasetConfigurations(
  _user TEXT NOT NULL,
  _dataset TEXT NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

CREATE TABLE webknossos.user_datasetLayerConfigurations(
  _user TEXT NOT NULL,
  _dataset TEXT NOT NULL,
  layerName TEXT NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset, layerName),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);


CREATE TYPE webknossos.THEME AS ENUM ('light', 'dark', 'auto');
CREATE TABLE webknossos.multiUsers(
  _id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt',
  passwordInfo_password TEXT NOT NULL,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  novelUserExperienceInfos JSONB NOT NULL DEFAULT '{}'::json,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selectedTheme webknossos.THEME NOT NULL DEFAULT 'auto',
  _lastLoggedInIdentity TEXT DEFAULT NULL,
  isEmailVerified BOOLEAN NOT NULL DEFAULT false,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT nuxInfoIsJsonObject CHECK(jsonb_typeof(novelUserExperienceInfos) = 'object')
);


CREATE TYPE webknossos.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword');
CREATE TYPE webknossos.USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');
CREATE TABLE webknossos.tokens(
  _id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  loginInfo_providerID webknossos.USER_LOGININFO_PROVDERIDS NOT NULL,
  loginInfo_providerKey TEXT NOT NULL,
  lastUsedDateTime TIMESTAMPTZ NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  idleTimeout BIGINT,
  tokenType webknossos.TOKEN_TYPES NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.maintenances(
  _id TEXT PRIMARY KEY,
  _user TEXT NOT NULL,
  startTime TIMESTAMPTZ NOT NULL,
  endTime TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.workers(
  _id TEXT PRIMARY KEY,
  _dataStore TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Unnamed Worker',
  key TEXT NOT NULL UNIQUE,
  maxParallelHighPriorityJobs INT NOT NULL DEFAULT 1,
  maxParallelLowPriorityJobs INT NOT NULL DEFAULT 1,
  supportedJobCommands TEXT[] NOT NULL DEFAULT array[]::TEXT[],
  lastHeartBeat TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01T00:00:00Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);


CREATE TYPE webknossos.JOB_STATE AS ENUM ('PENDING', 'STARTED', 'SUCCESS', 'FAILURE', 'CANCELLED');

CREATE TABLE webknossos.jobs(
  _id TEXT PRIMARY KEY,
  _owner TEXT NOT NULL,
  _dataStore TEXT NOT NULL,
  command TEXT NOT NULL,
  commandArgs JSONB NOT NULL,
  state webknossos.JOB_STATE NOT NULL DEFAULT 'PENDING', -- always updated by the worker
  manualState webknossos.JOB_STATE, -- set by the user or admin
  _worker TEXT,
  _voxelytics_workflowHash TEXT,
  latestRunId TEXT,
  returnValue Text,
  retriedBySuperUser BOOLEAN NOT NULL DEFAULT false,
  started TIMESTAMPTZ,
  ended TIMESTAMPTZ,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);


CREATE TABLE webknossos.invites(
  _id TEXT PRIMARY KEY,
  tokenValue Text NOT NULL,
  _organization TEXT NOT NULL,
  autoActivate BOOLEAN NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.annotation_privateLinks(
  _id TEXT PRIMARY KEY,
  _annotation TEXT NOT NULL,
  accessToken Text NOT NULL UNIQUE,
  expirationDateTime TIMESTAMPTZ,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.shortLinks(
  _id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HttpBasicAuth', 'HttpToken', 'S3AccessKey', 'GoogleServiceAccount');
CREATE TABLE webknossos.credentials(
  _id TEXT PRIMARY KEY,
  type webknossos.CREDENTIAL_TYPE NOT NULL,
  name TEXT NOT NULL,
  identifier Text,
  secret Text,
  _user TEXT NOT NULL,
  _organization TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.folders(
    _id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (name !~ '/'),
    isDeleted BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB  NOT NULL DEFAULT '[]',
    CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array')
);

CREATE TABLE webknossos.folder_paths(
    _ancestor TEXT NOT NULL,
    _descendant TEXT NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY(_ancestor, _descendant)
);

CREATE TABLE webknossos.folder_allowedTeams(
  _folder TEXT NOT NULL,
  _team TEXT NOT NULL,
  PRIMARY KEY (_folder, _team)
);

CREATE TABLE webknossos.emailVerificationKeys(
  _id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  email TEXT NOT NULL,
  _multiUser TEXT NOT NULL,
  validUntil TIMESTAMPTZ,
  isUsed BOOLEAN NOT NULL DEFAULT false
);

CREATE TYPE webknossos.AI_MODEL_CATEGORY AS ENUM ('em_neurons', 'em_nuclei', 'em_synapses', 'em_neuron_types', 'em_cell_organelles');

CREATE TABLE webknossos.aiModels(
  _id TEXT PRIMARY KEY,
  _organization TEXT NOT NULL,
  _dataStore TEXT NOT NULL, -- redundant to job, but must be available for jobless models
  _user TEXT NOT NULL,
  _trainingJob TEXT,
  name TEXT NOT NULL,
  comment TEXT,
  category webknossos.AI_MODEL_CATEGORY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (_organization, name)
);

CREATE TABLE webknossos.aiModel_trainingAnnotations(
  _aiModel TEXT NOT NULL,
  _annotation TEXT NOT NULL,
  PRIMARY KEY(_aiModel,_annotation)
);

CREATE TABLE webknossos.aiInferences(
  _id TEXT PRIMARY KEY,
  _organization TEXT NOT NULL,
  _aiModel TEXT NOT NULL,
  _newDataset TEXT,
  _annotation TEXT,
  _inferenceJob TEXT NOT NULL,
  boundingBox webknossos.BOUNDING_BOX NOT NULL,
  newSegmentationLayerName TEXT NOT NULL,
  maskAnnotationLayerName TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE webknossos.VOXELYTICS_RUN_STATE AS ENUM ('PENDING', 'SKIPPED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED', 'STALE');

CREATE TABLE webknossos.voxelytics_artifacts(
    _id TEXT NOT NULL,
    _task TEXT NOT NULL,
    name TEXT NOT NULL,
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
    _id TEXT NOT NULL,
    _organization TEXT NOT NULL,
    _user TEXT NOT NULL,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    hostname TEXT NOT NULL,
    voxelyticsVersion TEXT NOT NULL,
    workflow_hash TEXT NOT NULL,
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
    _id TEXT NOT NULL,
    _run TEXT NOT NULL,
    name TEXT NOT NULL,
    task TEXT NOT NULL,
    config JSONB NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_run, name),
    CONSTRAINT configIsJsonObject CHECK(jsonb_typeof(config) = 'object')
);

CREATE TABLE webknossos.voxelytics_chunks(
    _id TEXT NOT NULL,
    _task TEXT NOT NULL,
    executionId TEXT NOT NULL,
    chunkName TEXT NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state webknossos.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_task, executionId, chunkName)
);

CREATE TABLE webknossos.voxelytics_workflows(
    _organization TEXT NOT NULL,
    hash TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (_organization, hash)
);

CREATE TABLE webknossos.voxelytics_runHeartbeatEvents(
    _run TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_run)
);

CREATE TABLE webknossos.voxelytics_chunkProfilingEvents(
    _chunk TEXT NOT NULL,
    hostname TEXT NOT NULL,
    pid INT8 NOT NULL,
    memory FLOAT NOT NULL,
    cpuUser FLOAT NOT NULL,
    cpuSystem FLOAT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_chunk, timestamp)
);

CREATE TABLE webknossos.voxelytics_artifactFileChecksumEvents(
    _artifact TEXT NOT NULL,
    path TEXT NOT NULL,
    resolvedPath TEXT NOT NULL,
    checksumMethod TEXT NOT NULL,
    checksum TEXT NOT NULL,
    fileSize INT8 NOT NULL,
    lastModified TIMESTAMPTZ NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_artifact, path, timestamp)
);

CREATE TABLE webknossos.analyticsEvents(
  _id TEXT PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessionId BIGINT NOT NULL,
  eventType TEXT NOT NULL,
  eventProperties JSONB NOT NULL,
  _user TEXT NOT NULL,
  _organization TEXT NOT NULL,
  isOrganizationAdmin BOOLEAN NOT NULL,
  isSuperUser BOOLEAN NOT NULL,
  webknossosUri TEXT NOT NULL,
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


CREATE FUNCTION webknossos.onDeleteAnnotation() RETURNS trigger AS $$
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

