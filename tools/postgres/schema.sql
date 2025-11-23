DROP SCHEMA IF EXISTS wk CASCADE;
CREATE SCHEMA wk;

CREATE TYPE wk.vector_3 AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION
);

CREATE TYPE wk.bounding_box AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  width DOUBLE PRECISION,
  height DOUBLE PRECISION,
  depth DOUBLE PRECISION
);

START TRANSACTION;
CREATE TABLE wk.release_information (
  schema_version BIGINT NOT NULL
);
INSERT INTO wk.release_information(schema_version) values(145);
COMMIT TRANSACTION;

CREATE TYPE wk.annotation_type AS ENUM ('Task', 'Explorational', 'TracingBase', 'Orphan');
CREATE TYPE wk.annotation_state AS ENUM ('Active', 'Finished', 'Cancelled', 'Initializing');
CREATE TYPE wk.annotation_visibility AS ENUM ('Private', 'Internal', 'Public');
CREATE TABLE wk.annotations(
  id TEXT CONSTRAINT id_objectId CHECK (id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  dataset_id TEXT CONSTRAINT dataset_id_objectId CHECK (dataset_id ~ '^[0-9a-f]{24}$') NOT NULL,
  task_id TEXT CONSTRAINT task_id_objectId CHECK (task_id ~ '^[0-9a-f]{24}$'),
  team_id TEXT CONSTRAINT team_id_objectId CHECK (team_id ~ '^[0-9a-f]{24}$') NOT NULL,
  user_id TEXT CONSTRAINT user_id_objectId CHECK (user_id ~ '^[0-9a-f]{24}$') NOT NULL,
  publication_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  visibility wk.annotation_visibility NOT NULL DEFAULT 'Internal',
  name TEXT NOT NULL DEFAULT '',
  view_configuration JSONB,
  state wk.annotation_state NOT NULL DEFAULT 'Active',
  is_locked_by_owner BOOLEAN NOT NULL DEFAULT FALSE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  tracing_time BIGINT,
  type wk.annotation_type NOT NULL,
  others_may_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK ((typ IN ('TracingBase', 'Task')) = (_task IS NOT NULL))
);

CREATE TYPE wk.annotation_layer_type AS ENUM ('Skeleton', 'Volume');
CREATE TABLE wk.annotation_layers(
  annotation_id TEXT CONSTRAINT annotation_id_objectId CHECK (annotation_id ~ '^[0-9a-f]{24}$') NOT NULL,
  tracing_id TEXT NOT NULL UNIQUE,
  type wk.annotation_layer_type NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.\$]+$'),
  statistics JSONB NOT NULL,
  UNIQUE (name, annotation_id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (annotation_id, tracing_id),
  CONSTRAINT statistics_is_json_object CHECK(jsonb_typeof(statistics) = 'object')
);

CREATE TABLE wk.annotation_shared_teams(
  annotation_id TEXT CONSTRAINT annotation_id_objectId CHECK (annotation_id ~ '^[0-9a-f]{24}$') NOT NULL,
  team_id TEXT CONSTRAINT team_id_objectId CHECK (team_id ~ '^[0-9a-f]{24}$') NOT NULL,
  PRIMARY KEY (annotation_id, team)
);

CREATE TABLE wk.annotation_contributors(
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') NOT NULL,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  PRIMARY KEY (_annotation, _user)
);

CREATE TABLE wk.annotation_mutexes(
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  expiry TIMESTAMP NOT NULL
);

CREATE TABLE wk.publications(
  _id TEXT PRIMARY KEY,
  publicationDate TIMESTAMPTZ,
  imageUrl TEXT,
  title TEXT,
  description TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE wk.LENGTH_UNIT AS ENUM ('yoctometer', 'zeptometer', 'attometer', 'femtometer', 'picometer', 'nanometer', 'micrometer', 'millimeter', 'centimeter', 'decimeter', 'meter', 'hectometer', 'kilometer', 'megameter', 'gigameter', 'terameter', 'petameter', 'exameter', 'zettameter', 'yottameter', 'angstrom', 'inch', 'foot', 'yard', 'mile', 'parsec');
CREATE TABLE wk.datasets(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _dataStore TEXT NOT NULL,
  _organization TEXT NOT NULL,
  _publication TEXT,
  _uploader TEXT CONSTRAINT _uploader_objectId CHECK (_uploader ~ '^[0-9a-f]{24}$'),
  _folder TEXT CONSTRAINT _folder_objectId CHECK (_folder ~ '^[0-9a-f]{24}$') NOT NULL,
  inboxSourceHash INT,
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  description TEXT,
  name TEXT NOT NULL,
  isPublic BOOLEAN NOT NULL DEFAULT FALSE,
  isUsable BOOLEAN NOT NULL DEFAULT FALSE,
  isVirtual BOOLEAN NOT NULL DEFAULT FALSE,
  directoryName TEXT NOT NULL,
  voxelSizeFactor wk.VECTOR3,
  voxelSizeUnit wk.LENGTH_UNIT,
  status TEXT NOT NULL DEFAULT '',
  sharingToken TEXT,
  logoUrl TEXT,
  sortingKey TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (directoryName, _organization),
  CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object'),
  CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object'),
  CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array')
);

CREATE TYPE wk.DATASET_LAYER_CATEGORY AS ENUM ('color', 'mask', 'segmentation');
CREATE TYPE wk.DATASET_LAYER_ELEMENT_CLASS AS ENUM ('uint8', 'uint16', 'uint24', 'uint32', 'uint64', 'float', 'double', 'int8', 'int16', 'int32', 'int64');
CREATE TYPE wk.DATASET_LAYER_DATAFORMAT AS ENUM ('wkw','zarr','zarr3','n5','neuroglancerPrecomputed');
CREATE TABLE wk.dataset_layers(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  name TEXT NOT NULL,
  category wk.DATASET_LAYER_CATEGORY NOT NULL,
  elementClass wk.DATASET_LAYER_ELEMENT_CLASS NOT NULL,
  boundingBox wk.BOUNDING_BOX NOT NULL,
  largestSegmentId BIGINT,
  mappings TEXT[],
  defaultViewConfiguration JSONB,
  adminViewConfiguration JSONB,
  numChannels INT,
  dataFormat wk.DATASET_LAYER_DATAFORMAT,
  PRIMARY KEY(_dataset, name),
  CONSTRAINT defaultViewConfigurationIsJsonObject CHECK(jsonb_typeof(defaultViewConfiguration) = 'object'),
  CONSTRAINT adminViewConfigurationIsJsonObject CHECK(jsonb_typeof(adminViewConfiguration) = 'object')
);

CREATE TABLE wk.dataset_layer_coordinateTransformations(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  type TEXT NOT NULL,
  matrix JSONB,
  correspondences JSONB,
  insertionOrderIndex INT
);

CREATE TABLE wk.dataset_layer_additionalAxes(
   _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
   layerName TEXT NOT NULL,
   name TEXT NOT NULL,
   lowerBound INT NOT NULL,
   upperBound INT NOT NULL,
   index INT NOT NULL
);

CREATE TYPE wk.LAYER_ATTACHMENT_TYPE AS ENUM ('agglomerate', 'connectome', 'segmentIndex', 'mesh', 'cumsum');
CREATE TYPE wk.LAYER_ATTACHMENT_DATAFORMAT AS ENUM ('hdf5', 'zarr3', 'json', 'neuroglancerPrecomputed');
CREATE TABLE wk.dataset_layer_attachments(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  realPath TEXT,
  hasLocalData BOOLEAN NOT NULL DEFAULT FALSE,
  type wk.LAYER_ATTACHMENT_TYPE NOT NULL,
  dataFormat wk.LAYER_ATTACHMENT_DATAFORMAT NOT NULL,
  uploadToPathIsPending BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(_dataset, layerName, name, type)
);

CREATE TABLE wk.dataset_allowedTeams(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  PRIMARY KEY (_dataset, _team)
);

CREATE TABLE wk.dataset_mags(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  dataLayerName TEXT,
  mag wk.VECTOR3 NOT NULL,
  path TEXT,
  realPath TEXT,
  hasLocalData BOOLEAN NOT NULL DEFAULT FALSE,
  axisOrder JSONB CONSTRAINT axisOrder_requiredKeys CHECK (axisOrder ? 'x' AND axisOrder ? 'y'),
  channelIndex INT,
  credentialId TEXT,
  PRIMARY KEY (_dataset, dataLayerName, mag)
);

CREATE TABLE wk.dataset_lastUsedTimes(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  lastUsedTime TIMESTAMPTZ NOT NULL
);

CREATE TABLE wk.dataset_thumbnails(
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  dataLayerName TEXT,
  width INT NOT NULL,
  height INT NOT NULL,
  mappingName TEXT NOT NULL, -- emptystring means no mapping
  image BYTEA NOT NULL,
  mimetype TEXT,
  mag wk.VECTOR3 NOT NULL,
  mag1BoundingBox wk.BOUNDING_BOX NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_dataset, dataLayerName, width, height, mappingName)
);

CREATE TABLE wk.data_stores(
  name TEXT PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url TEXT UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  public_url TEXT UNIQUE NOT NULL CHECK (public_url ~* '^https?://[a-z0-9\.]+.*$'),
  key TEXT NOT NULL,
  is_scratch BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  allows_upload BOOLEAN NOT NULL DEFAULT TRUE,
  allows_upload_to_paths BOOLEAN NOT NULL DEFAULT TRUE,
  only_allowed_organization TEXT,
  report_used_storage_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.tracing_stores(
  name TEXT PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url TEXT UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  publicUrl TEXT UNIQUE NOT NULL CHECK (publicUrl ~* '^https?://[a-z0-9\.]+.*$'),
  key TEXT NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.projects(
  id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  _organization TEXT NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  _owner TEXT CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$') NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^.{3,}$'), -- Unique among non-deleted, enforced in scala
  priority BIGINT NOT NULL DEFAULT 100,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  expectedTime BIGINT,
  isBlacklistedFromReport BOOLEAN NOT NULL DEFAULT FALSE,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.scripts(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _owner TEXT CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$') NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  gist TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (gist ~* '^https?://[a-z0-9\-_\.]+.*$')
);

CREATE TYPE wk.TASKTYPE_MODES AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');
CREATE TYPE wk.TASKTYPE_TRACINGTYPES AS ENUM ('skeleton', 'volume', 'hybrid');
CREATE TABLE wk.taskTypes(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _organization TEXT NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  settings_allowedModes wk.TASKTYPE_MODES[] NOT NULL DEFAULT '{orthogonal, flight, oblique}',
  settings_preferredMode wk.TASKTYPE_MODES DEFAULT 'orthogonal',
  settings_branchPointsAllowed BOOLEAN NOT NULL,
  settings_somaClickingAllowed BOOLEAN NOT NULL,
  settings_volumeInterpolationAllowed BOOLEAN NOT NULL DEFAULT FALSE,
  settings_mergerMode BOOLEAN NOT NULL DEFAULT FALSE,
  settings_magRestrictions_min INT DEFAULT NULL,
  settings_magRestrictions_max INT DEFAULT NULL,
  recommendedConfiguration JSONB,
  tracingType wk.TASKTYPE_TRACINGTYPES NOT NULL DEFAULT 'skeleton',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT recommendedConfigurationIsJsonObject CHECK(jsonb_typeof(recommendedConfiguration) = 'object'),
  UNIQUE (summary, _organization)
);

CREATE TABLE wk.tasks(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _project TEXT CONSTRAINT _project_objectId CHECK (_project ~ '^[0-9a-f]{24}$') NOT NULL,
  _script TEXT CONSTRAINT _script_objectId CHECK (_script ~ '^[0-9a-f]{24}$'),
  _taskType TEXT CONSTRAINT _taskType_objectId CHECK (_taskType ~ '^[0-9a-f]{24}$') NOT NULL,
  neededExperience_domain TEXT NOT NULL CHECK (neededExperience_domain ~* '^.{2,}$'),
  neededExperience_value INT NOT NULL,
  totalInstances BIGINT NOT NULL,
  pendingInstances BIGINT NOT NULL,
  tracingTime BIGINT,
  boundingBox wk.BOUNDING_BOX,
  editPosition wk.VECTOR3 NOT NULL,
  editRotation wk.VECTOR3 NOT NULL,
  creationInfo TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT pendingInstancesLargeEnoughCheck CHECK (pendingInstances >= 0)
);

CREATE TABLE wk.experienceDomains(
  domain TEXT NOT NULL,
  _organization TEXT NOT NULL,
  CONSTRAINT primarykey__domain_orga PRIMARY KEY (domain,_organization)
);

CREATE TABLE wk.teams(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _organization TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isOrganizationTeam BOOLEAN NOT NULL DEFAULT FALSE,
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (name, _organization)
);

CREATE TABLE wk.timespans(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$'),
  time BIGINT NOT NULL,
  lastUpdate TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  numberOfUpdates BIGINT NOT NULL DEFAULT 1,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE wk.PRICING_PLANS AS ENUM ('Personal', 'Team', 'Power', 'Team_Trial', 'Power_Trial', 'Custom');
CREATE TABLE wk.organizations(
  _id_old TEXT CONSTRAINT _id_old_objectId CHECK (_id_old ~ '^[0-9a-f]{24}$') DEFAULT NULL,
  _id TEXT PRIMARY KEY,
  additionalInformation TEXT NOT NULL DEFAULT '',
  logoUrl TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  _rootFolder TEXT CONSTRAINT _rootFolder_objectId CHECK (_rootFolder ~ '^[0-9a-f]{24}$') NOT NULL UNIQUE,
  newUserMailingList TEXT NOT NULL DEFAULT '',
  enableAutoVerify BOOLEAN NOT NULL DEFAULT FALSE,
  pricingPlan wk.PRICING_PLANS NOT NULL DEFAULT 'Custom',
  paidUntil TIMESTAMPTZ DEFAULT NULL,
  includedUsers INTEGER DEFAULT NULL,
  includedStorage BIGINT DEFAULT NULL,
  lastTermsOfServiceAcceptanceTime TIMESTAMPTZ,
  lastTermsOfServiceAcceptanceVersion INT NOT NULL DEFAULT 0,
  lastStorageScanTime TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT validOrganizationId CHECK (_id ~* '^[A-Za-z0-9\-_. ]+$')
);

CREATE TABLE wk.organization_usedStorage_mags (
    _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
    layerName TEXT NOT NULL,
    mag wk.VECTOR3 NOT NULL,
    path TEXT NOT NULL,
    _organization TEXT NOT NULL,
    usedStorageBytes BIGINT NOT NULL CHECK (usedStorageBytes >= 0),
    lastUpdated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (_dataset, layerName, mag)
);

CREATE TABLE wk.organization_usedStorage_attachments (
    _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
    layerName TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type wk.LAYER_ATTACHMENT_TYPE NOT NULL,
    _organization TEXT NOT NULL,
    usedStorageBytes BIGINT NOT NULL CHECK (usedStorageBytes >= 0),
    lastUpdated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (_dataset, layerName, name, type)
);

-- Create the enum types for transaction states and credit states
-- Pending -> The transaction is a payment for a unfinished & not crashed job
-- Complete -> The transaction is committed and the potential associated job finished successfully or was refunded.
CREATE TYPE wk.credit_transaction_state AS ENUM ('Pending', 'Complete');
-- Pending -> The credit_delta is yet to be completed
-- Spent -> The credit_delta is committed as reduced as the associated job finished successfully.
-- Refunded -> The credit_delta is committed as reduced but a new refunding transaction is added as the associated job finished failed.
-- Revoked -> The credit_delta has been fully revoked by a revoking transaction as the credit_delta expired.
-- PartiallyRevoked -> The credit_delta has been partially revoked by a revoking transaction as the credit_delta expired but parts of it were already spent or are pending.
-- Refunding -> Marks credit_delta as a refund for transaction associated with a failed job.
-- Revoking -> The credit_delta of this transaction revokes the credit_delta of another transaction with expired credits.
-- AddCredits -> The credit_delta of this transaction adds adds more credits for the organization.
CREATE TYPE wk.credit_state AS ENUM ('Pending', 'Spent', 'Refunded', 'Revoked', 'PartiallyRevoked', 'Refunding', 'Revoking', 'AddCredits');

CREATE TABLE wk.credit_transactions (
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
    _organization TEXT NOT NULL,
    _related_transaction TEXT CONSTRAINT _related_transaction_objectId CHECK (_related_transaction ~ '^[0-9a-f]{24}$') DEFAULT NULL,
    _paid_job TEXT CONSTRAINT _paid_job_objectId CHECK (_paid_job ~ '^[0-9a-f]{24}$') DEFAULT NULL,
    credit_delta DECIMAL(14, 3) NOT NULL,
    comment TEXT NOT NULL,
    -- The state of the transaction.
    transaction_state wk.credit_transaction_state NOT NULL,
    -- The state of the credits of this transaction.
    credit_state wk.credit_state NOT NULL,
    expiration_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE wk.USER_PASSWORDINFO_HASHERS AS ENUM ('SCrypt', 'Empty');
CREATE TABLE wk.users(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _multiUser TEXT CONSTRAINT _multiUser_objectId CHECK (_multiUser ~ '^[0-9a-f]{24}$') NOT NULL,
  _organization TEXT NOT NULL,
  firstName TEXT NOT NULL, -- CHECK (firstName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastName TEXT NOT NULL, -- CHECK (lastName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastActivity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  userConfiguration JSONB NOT NULL,
  isDeactivated BOOLEAN NOT NULL DEFAULT FALSE,
  isAdmin BOOLEAN NOT NULL DEFAULT FALSE,
  isOrganizationOwner BOOLEAN NOT NULL DEFAULT FALSE,
  isDatasetManager BOOLEAN NOT NULL DEFAULT FALSE,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lastTaskTypeId TEXT CONSTRAINT lastTaskTypeId_objectId CHECK (lastTaskTypeId ~ '^[0-9a-f]{24}$') DEFAULT NULL,
  isUnlisted BOOLEAN NOT NULL DEFAULT FALSE,
  loggedOutEverywhereTime TIMESTAMPTZ,
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (_multiUser, _organization),
  CONSTRAINT userConfigurationIsJsonObject CHECK(jsonb_typeof(userConfiguration) = 'object')
);

CREATE TABLE wk.user_team_roles(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  isTeamManager BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (_user, _team)
);

CREATE TABLE wk.user_experiences(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  domain TEXT NOT NULL,
  value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (_user, domain)
);

CREATE TABLE wk.user_datasetConfigurations(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);

CREATE TABLE wk.user_datasetLayerConfigurations(
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _dataset TEXT CONSTRAINT _dataset_objectId CHECK (_dataset ~ '^[0-9a-f]{24}$') NOT NULL,
  layerName TEXT NOT NULL,
  viewConfiguration JSONB NOT NULL,
  PRIMARY KEY (_user, _dataset, layerName),
  CONSTRAINT viewConfigurationIsJsonObject CHECK(jsonb_typeof(viewConfiguration) = 'object')
);


CREATE TYPE wk.THEME AS ENUM ('light', 'dark', 'auto');
CREATE TABLE wk.multiUsers(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  passwordInfo_hasher wk.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt',
  passwordInfo_password TEXT NOT NULL,
  isSuperUser BOOLEAN NOT NULL DEFAULT FALSE,
  novelUserExperienceInfos JSONB NOT NULL DEFAULT '{}'::json,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selectedTheme wk.THEME NOT NULL DEFAULT 'auto',
  _lastLoggedInIdentity TEXT CONSTRAINT _lastLoggedInIdentity_objectId CHECK (_lastLoggedInIdentity ~ '^[0-9a-f]{24}$') DEFAULT NULL,
  isEmailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  emailChangeDate TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT nuxInfoIsJsonObject CHECK(jsonb_typeof(novelUserExperienceInfos) = 'object')
);

CREATE TABLE wk.webauthnCredentials(
  _id TEXT PRIMARY KEY,
  _multiUser TEXT NOT NULL,
  credentialId BYTEA NOT NULL,
  name TEXT NOT NULL,
  userVerified BOOLEAN NOT NULL,
  backupEligible BOOLEAN NOT NULL,
  backupState BOOLEAN NOT NULL,
  serializedAttestationStatement JSONB NOT NULL,
  serializedAttestedCredential BYTEA NOT NULL,
  serializedExtensions JSONB NOT NULL,
  signatureCount INTEGER NOT NULL DEFAULT 0,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (_multiUser, credentialId)
);


CREATE TYPE wk.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword');
CREATE TYPE wk.USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');
CREATE TABLE wk.tokens(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  value TEXT NOT NULL,
  loginInfo_providerID wk.USER_LOGININFO_PROVDERIDS NOT NULL,
  loginInfo_providerKey TEXT NOT NULL,
  lastUsedDateTime TIMESTAMPTZ NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  idleTimeout BIGINT,
  tokenType wk.TOKEN_TYPES NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.maintenances(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  startTime TIMESTAMPTZ NOT NULL,
  endTime TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.workers(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _dataStore TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Unnamed Worker',
  key TEXT NOT NULL UNIQUE,
  maxParallelHighPriorityJobs INT NOT NULL DEFAULT 1,
  maxParallelLowPriorityJobs INT NOT NULL DEFAULT 1,
  supportedJobCommands TEXT[] NOT NULL DEFAULT array[]::TEXT[],
  lastHeartBeat TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01T00:00:00Z',
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);


CREATE TYPE wk.JOB_STATE AS ENUM ('PENDING', 'STARTED', 'SUCCESS', 'FAILURE', 'CANCELLED');

CREATE TABLE wk.jobs(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _owner TEXT CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$') NOT NULL,
  _dataStore TEXT NOT NULL,
  command TEXT NOT NULL,
  commandArgs JSONB NOT NULL,
  state wk.JOB_STATE NOT NULL DEFAULT 'PENDING', -- always updated by the worker
  manualState wk.JOB_STATE, -- set by the user or admin
  _worker TEXT CONSTRAINT _worker_objectId CHECK (_worker ~ '^[0-9a-f]{24}$'),
  _voxelytics_workflowHash TEXT,
  latestRunId TEXT,
  returnValue Text,
  retriedBySuperUser BOOLEAN NOT NULL DEFAULT FALSE,
  started TIMESTAMPTZ,
  ended TIMESTAMPTZ,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);


CREATE TABLE wk.invites(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  tokenValue Text NOT NULL,
  _organization TEXT NOT NULL,
  autoActivate BOOLEAN NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.annotation_privateLinks(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') NOT NULL,
  accessToken Text NOT NULL UNIQUE,
  expirationDateTime TIMESTAMPTZ,
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.shortLinks(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE TYPE wk.CREDENTIAL_TYPE AS ENUM ('HttpBasicAuth', 'HttpToken', 'S3AccessKey', 'GoogleServiceAccount');
CREATE TABLE wk.credentials(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  type wk.CREDENTIAL_TYPE NOT NULL,
  name TEXT NOT NULL,
  identifier Text,
  secret Text,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _organization TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wk.folders(
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
    name TEXT NOT NULL CHECK (name !~ '/'),
    isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB  NOT NULL DEFAULT '[]',
    CONSTRAINT metadataIsJsonArray CHECK(jsonb_typeof(metadata) = 'array')
);

CREATE TABLE wk.folder_paths(
    _ancestor TEXT CONSTRAINT _ancestor_objectId CHECK (_ancestor ~ '^[0-9a-f]{24}$') NOT NULL,
    _descendant TEXT CONSTRAINT _descendant_objectId CHECK (_descendant ~ '^[0-9a-f]{24}$') NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY(_ancestor, _descendant)
);

CREATE TABLE wk.folder_allowedTeams(
  _folder TEXT CONSTRAINT _folder_objectId CHECK (_folder ~ '^[0-9a-f]{24}$') NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  PRIMARY KEY (_folder, _team)
);

CREATE TABLE wk.emailVerificationKeys(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  key TEXT NOT NULL,
  email TEXT NOT NULL,
  _multiUser TEXT CONSTRAINT _multiUser_objectId CHECK (_multiUser ~ '^[0-9a-f]{24}$') NOT NULL,
  validUntil TIMESTAMPTZ,
  isUsed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE wk.AI_MODEL_CATEGORY AS ENUM ('em_neurons', 'em_nuclei', 'em_synapses', 'em_neuron_types', 'em_cell_organelles');

CREATE TABLE wk.aiModels(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _organization TEXT NOT NULL,
  _dataStore TEXT NOT NULL, -- redundant to job, but must be available for jobless models
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _trainingJob TEXT CONSTRAINT _trainingJob_objectId CHECK (_trainingJob ~ '^[0-9a-f]{24}$'),
  name TEXT NOT NULL,
  comment TEXT,
  category wk.AI_MODEL_CATEGORY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (_organization, name)
);

CREATE TABLE wk.aiModel_organizations(
  _aiModel TEXT CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$') NOT NULL,
  _organization TEXT NOT NULL,
  PRIMARY KEY(_aiModel, _organization)
);

CREATE TABLE wk.aiModel_trainingAnnotations(
  _aiModel TEXT CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$') NOT NULL,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') NOT NULL,
  PRIMARY KEY(_aiModel,_annotation)
);

CREATE TABLE wk.aiInferences(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _organization TEXT NOT NULL,
  _aiModel TEXT CONSTRAINT _aiModel_objectId CHECK (_aiModel ~ '^[0-9a-f]{24}$') NOT NULL,
  _newDataset TEXT CONSTRAINT _newDataset_objectId CHECK (_newDataset ~ '^[0-9a-f]{24}$'),
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$'),
  _inferenceJob TEXT CONSTRAINT _inferenceJob_objectId CHECK (_inferenceJob ~ '^[0-9a-f]{24}$') NOT NULL,
  boundingBox wk.BOUNDING_BOX NOT NULL,
  newSegmentationLayerName TEXT NOT NULL,
  maskAnnotationLayerName TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TYPE wk.VOXELYTICS_RUN_STATE AS ENUM ('PENDING', 'SKIPPED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED', 'STALE');

CREATE TABLE wk.voxelytics_artifacts(
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') NOT NULL,
    _task TEXT CONSTRAINT _task_objectId CHECK (_task ~ '^[0-9a-f]{24}$') NOT NULL,
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

CREATE TABLE wk.voxelytics_runs(
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') NOT NULL,
    _organization TEXT NOT NULL,
    _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    hostname TEXT NOT NULL,
    voxelyticsVersion TEXT NOT NULL,
    workflow_hash TEXT NOT NULL,
    workflow_yamlContent TEXT,
    workflow_config JSONB,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state wk.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_organization, name),
    CONSTRAINT workflowConfigIsJsonObject CHECK(jsonb_typeof(workflow_config) = 'object')
);

CREATE TABLE wk.voxelytics_tasks(
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') NOT NULL,
    _run TEXT CONSTRAINT _run_objectId CHECK (_run ~ '^[0-9a-f]{24}$') NOT NULL,
    name TEXT NOT NULL,
    task TEXT NOT NULL,
    config JSONB NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state wk.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_run, name),
    CONSTRAINT configIsJsonObject CHECK(jsonb_typeof(config) = 'object')
);

CREATE TABLE wk.voxelytics_chunks(
    _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') NOT NULL,
    _task TEXT CONSTRAINT _task_objectId CHECK (_task ~ '^[0-9a-f]{24}$') NOT NULL,
    executionId TEXT NOT NULL,
    chunkName TEXT NOT NULL,
    beginTime TIMESTAMPTZ,
    endTime TIMESTAMPTZ,
    state wk.voxelytics_run_state NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (_id),
    UNIQUE (_task, executionId, chunkName)
);

CREATE TABLE wk.voxelytics_workflows(
    _organization TEXT NOT NULL,
    hash TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (_organization, hash)
);

CREATE TABLE wk.voxelytics_runHeartbeatEvents(
    _run TEXT CONSTRAINT _run_objectId CHECK (_run ~ '^[0-9a-f]{24}$') NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_run)
);

CREATE TABLE wk.voxelytics_chunkProfilingEvents(
    _chunk TEXT CONSTRAINT _chunk_objectId CHECK (_chunk ~ '^[0-9a-f]{24}$') NOT NULL,
    hostname TEXT NOT NULL,
    pid INT8 NOT NULL,
    memory FLOAT NOT NULL,
    cpuUser FLOAT NOT NULL,
    cpuSystem FLOAT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_chunk, timestamp)
);

CREATE TABLE wk.voxelytics_artifactFileChecksumEvents(
    _artifact TEXT CONSTRAINT _artifact_objectId CHECK (_artifact ~ '^[0-9a-f]{24}$') NOT NULL,
    path TEXT NOT NULL,
    resolvedPath TEXT NOT NULL,
    checksumMethod TEXT NOT NULL,
    checksum TEXT NOT NULL,
    fileSize INT8 NOT NULL,
    lastModified TIMESTAMPTZ NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (_artifact, path, timestamp)
);

CREATE TABLE wk.analyticsEvents(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessionId BIGINT NOT NULL,
  eventType TEXT NOT NULL,
  eventProperties JSONB NOT NULL,
  _user TEXT CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$') NOT NULL,
  _organization TEXT NOT NULL,
  isOrganizationAdmin BOOLEAN NOT NULL,
  isSuperUser BOOLEAN NOT NULL,
  wkUri TEXT NOT NULL,
  CONSTRAINT eventProperties CHECK(jsonb_typeof(eventProperties) = 'object')
);


CREATE VIEW wk.annotations_ AS SELECT * FROM wk.annotations WHERE NOT isDeleted;
CREATE VIEW wk.publications_ AS SELECT * FROM wk.publications WHERE NOT isDeleted;
CREATE VIEW wk.datasets_ AS SELECT * FROM wk.datasets WHERE NOT isDeleted;
CREATE VIEW wk.dataStores_ AS SELECT * FROM wk.dataStores WHERE NOT isDeleted;
CREATE VIEW wk.tracingStores_ AS SELECT * FROM wk.tracingStores WHERE NOT isDeleted;
CREATE VIEW wk.projects_ AS SELECT * FROM wk.projects WHERE NOT isDeleted;
CREATE VIEW wk.scripts_ AS SELECT * FROM wk.scripts WHERE NOT isDeleted;
CREATE VIEW wk.taskTypes_ AS SELECT * FROM wk.taskTypes WHERE NOT isDeleted;
CREATE VIEW wk.tasks_ AS SELECT * FROM wk.tasks WHERE NOT isDeleted;
CREATE VIEW wk.teams_ AS SELECT * FROM wk.teams WHERE NOT isDeleted;
CREATE VIEW wk.timespans_ AS SELECT * FROM wk.timespans WHERE NOT isDeleted;
CREATE VIEW wk.organizations_ AS SELECT * FROM wk.organizations WHERE NOT isDeleted;
CREATE VIEW wk.users_ AS SELECT * FROM wk.users WHERE NOT isDeleted;
CREATE VIEW wk.multiUsers_ AS SELECT * FROM wk.multiUsers WHERE NOT isDeleted;
CREATE VIEW wk.tokens_ AS SELECT * FROM wk.tokens WHERE NOT isDeleted;
CREATE VIEW wk.jobs_ AS SELECT * FROM wk.jobs WHERE NOT isDeleted;
CREATE VIEW wk.workers_ AS SELECT * FROM wk.workers WHERE NOT isDeleted;
CREATE VIEW wk.invites_ AS SELECT * FROM wk.invites WHERE NOT isDeleted;
CREATE VIEW wk.organizationTeams AS SELECT * FROM wk.teams WHERE isOrganizationTeam AND NOT isDeleted;
CREATE VIEW wk.annotation_privateLinks_ as SELECT * FROM wk.annotation_privateLinks WHERE NOT isDeleted;
CREATE VIEW wk.folders_ as SELECT * FROM wk.folders WHERE NOT isDeleted;
CREATE VIEW wk.credentials_ as SELECT * FROM wk.credentials WHERE NOT isDeleted;
CREATE VIEW wk.maintenances_ as SELECT * FROM wk.maintenances WHERE NOT isDeleted;
CREATE VIEW wk.aiModels_ as SELECT * FROM wk.aiModels WHERE NOT isDeleted;
CREATE VIEW wk.aiInferences_ as SELECT * FROM wk.aiInferences WHERE NOT isDeleted;
CREATE VIEW wk.credit_transactions_ as SELECT * FROM wk.credit_transactions WHERE NOT is_deleted;
CREATE VIEW wk.webauthnCredentials_ as SELECT * FROM wk.webauthnCredentials WHERE NOT isDeleted;

CREATE VIEW wk.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o._id AS organization_id, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM wk.users_ u
JOIN wk.organizations_ o ON u._organization = o._id
JOIN wk.multiUsers_ m on u._multiUser = m._id;


CREATE INDEX ON wk.annotations(_user, isDeleted);
CREATE INDEX ON wk.annotations(_task, isDeleted);
CREATE INDEX ON wk.annotations(typ, state, isDeleted);
CREATE INDEX ON wk.annotations(_user, _task, isDeleted);
CREATE INDEX ON wk.annotations(_task, typ, isDeleted);
CREATE INDEX ON wk.annotations(typ, isDeleted);
CREATE INDEX ON wk.datasets(directoryName);
CREATE INDEX ON wk.datasets(_folder);
CREATE INDEX ON wk.tasks(_project);
CREATE INDEX ON wk.tasks(isDeleted);
CREATE INDEX ON wk.tasks(_project, isDeleted);
CREATE INDEX ON wk.tasks(neededExperience_domain, neededExperience_value);
CREATE INDEX ON wk.tasks(_taskType);
CREATE INDEX ON wk.timespans(_user);
CREATE INDEX ON wk.timespans(_annotation);
CREATE INDEX ON wk.users(_multiUser);
CREATE INDEX ON wk.users(created);
CREATE INDEX ON wk.users(_organization);
CREATE INDEX ON wk.users(isDeactivated);
CREATE INDEX ON wk.users(isUnlisted);
CREATE INDEX ON wk.multiUsers(email);
CREATE INDEX ON wk.projects(name);
CREATE INDEX ON wk.projects(_team);
CREATE INDEX ON wk.projects(name, isDeleted);
CREATE INDEX ON wk.projects(_team, isDeleted);
CREATE INDEX ON wk.invites(tokenValue);
CREATE INDEX ON wk.annotation_privateLinks(accessToken);
CREATE INDEX ON wk.shortLinks(key);
CREATE INDEX ON wk.credit_transactions(credit_state);
CREATE INDEX ON wk.dataset_mags(COALESCE(realPath, path));
CREATE INDEX ON wk.dataset_layer_attachments(path);
CREATE INDEX ON wk.organization_usedStorage_mags(_organization);
CREATE INDEX ON wk.organization_usedStorage_attachments(_organization);

ALTER TABLE wk.annotations
  ADD CONSTRAINT task_ref FOREIGN KEY(_task) REFERENCES wk.tasks(_id) ON DELETE SET NULL DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) DEFERRABLE,
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) DEFERRABLE,
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES wk.publications(_id) DEFERRABLE;
ALTER TABLE wk.annotation_sharedTeams
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES wk.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.annotation_contributors
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES wk.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.annotation_mutexes
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES wk.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.datasets
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES wk.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES wk.dataStores(name) DEFERRABLE,
  ADD CONSTRAINT uploader_ref FOREIGN KEY(_uploader) REFERENCES wk.users(_id) DEFERRABLE,
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES wk.publications(_id) DEFERRABLE;
ALTER TABLE wk.dataset_layers
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.dataset_allowedTeams
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.dataset_mags
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.projects ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) DEFERRABLE,
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES wk.users(_id) DEFERRABLE;
ALTER TABLE wk.scripts
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES wk.users(_id) DEFERRABLE;
ALTER TABLE wk.taskTypes
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.tasks
  ADD CONSTRAINT project_ref FOREIGN KEY(_project) REFERENCES wk.projects(_id) DEFERRABLE,
  ADD CONSTRAINT script_ref FOREIGN KEY(_script) REFERENCES wk.scripts(_id) ON DELETE SET NULL DEFERRABLE;
ALTER TABLE wk.teams
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES wk.organizations(_id) DEFERRABLE;
ALTER TABLE wk.timespans
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES wk.annotations(_id) ON DELETE SET NULL DEFERRABLE;
ALTER TABLE wk.users
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES wk.organizations(_id) DEFERRABLE;
ALTER TABLE wk.user_team_roles
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES wk.teams(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.user_experiences
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.user_datasetConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.credit_transactions
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES wk.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT paid_job_ref FOREIGN KEY(_paid_job) REFERENCES wk.jobs(_id) DEFERRABLE,
  ADD CONSTRAINT related_transaction_ref FOREIGN KEY(_related_transaction) REFERENCES wk.credit_transactions(_id) DEFERRABLE;
ALTER TABLE wk.user_datasetLayerConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES wk.users(_id) ON DELETE CASCADE DEFERRABLE,
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.multiUsers
  ADD CONSTRAINT lastLoggedInIdentity_ref FOREIGN KEY(_lastLoggedInIdentity) REFERENCES wk.users(_id) ON DELETE SET NULL;
ALTER TABLE wk.experienceDomains
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES wk.organizations(_id) DEFERRABLE;
ALTER TABLE wk.jobs
  ADD CONSTRAINT owner_ref FOREIGN KEY(_owner) REFERENCES wk.users(_id) DEFERRABLE,
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES wk.dataStores(name) DEFERRABLE,
  ADD CONSTRAINT worker_ref FOREIGN KEY(_worker) REFERENCES wk.workers(_id) DEFERRABLE;
ALTER TABLE wk.workers
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES wk.dataStores(name) DEFERRABLE;
ALTER TABLE wk.annotation_privateLinks
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES wk.annotations(_id) DEFERRABLE;
ALTER TABLE wk.folder_paths
  ADD FOREIGN KEY (_ancestor) REFERENCES wk.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.folder_paths
  ADD FOREIGN KEY (_descendant) REFERENCES wk.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.organizations
  ADD FOREIGN KEY (_rootFolder) REFERENCES wk.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.organization_usedStorage_mags
  ADD CONSTRAINT mags_ref FOREIGN KEY (_dataset, layerName, mag) REFERENCES wk.dataset_mags(_dataset, dataLayerName, mag) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.organization_usedStorage_attachments
  ADD CONSTRAINT attachments_ref FOREIGN KEY (_dataset, layerName, name, type) REFERENCES wk.dataset_layer_attachments(_dataset, layerName, name, type) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.dataset_layer_coordinateTransformations
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) DEFERRABLE;
ALTER TABLE wk.dataset_layer_additionalAxes
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) DEFERRABLE;
ALTER TABLE wk.dataset_layer_attachments
  ADD CONSTRAINT dataset_ref FOREIGN KEY(_dataset) REFERENCES wk.datasets(_id) DEFERRABLE,
  ADD CONSTRAINT layer_ref FOREIGN KEY(_dataset, layerName) REFERENCES wk.dataset_layers(_dataset, name) ON DELETE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_artifacts
  ADD FOREIGN KEY (_task) REFERENCES wk.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_runs
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES wk.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  -- explicit naming for this constraint, as different postgres versions give different names to tuple key constraints
  ADD CONSTRAINT voxelytics_runs__organization_workflow_hash_fkey FOREIGN KEY (_organization, workflow_hash) REFERENCES wk.voxelytics_workflows(_organization, hash) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_tasks
  ADD FOREIGN KEY (_run) REFERENCES wk.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_chunks
  ADD FOREIGN KEY (_task) REFERENCES wk.voxelytics_tasks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_workflows
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES wk.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_runHeartbeatEvents
  ADD FOREIGN KEY (_run) REFERENCES wk.voxelytics_runs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_chunkProfilingEvents
  ADD FOREIGN KEY (_chunk) REFERENCES wk.voxelytics_chunks(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.voxelytics_artifactFileChecksumEvents
  ADD FOREIGN KEY (_artifact) REFERENCES wk.voxelytics_artifacts(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.aiModels
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES wk.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_dataStore) REFERENCES wk.datastores(name) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_user) REFERENCES wk.users(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_trainingJob) REFERENCES wk.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.aiInferences
  ADD CONSTRAINT organization_ref FOREIGN KEY (_organization) REFERENCES wk.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_aiModel) REFERENCES wk.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_newDataset) REFERENCES wk.datasets(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES wk.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_inferenceJob) REFERENCES wk.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.aiModel_trainingAnnotations
  ADD FOREIGN KEY (_aiModel) REFERENCES wk.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES wk.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.aiModel_organizations
  ADD FOREIGN KEY (_aiModel) REFERENCES wk.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_organization) REFERENCES wk.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE wk.webauthnCredentials
  ADD FOREIGN KEY (_multiUser) REFERENCES wk.multiUsers(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;


CREATE FUNCTION wk.countsAsTaskInstance(a wk.annotations) RETURNS BOOLEAN AS $$
  BEGIN
    RETURN (a.state != 'Cancelled' AND a.isDeleted = FALSE AND a.typ = 'Task');
  END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION wk.onUpdateTask() RETURNS trigger AS $$
  BEGIN
    IF NEW.totalInstances <> OLD.totalInstances THEN
      UPDATE wk.tasks SET pendingInstances = pendingInstances + (NEW.totalInstances - OLD.totalInstances) WHERE _id = NEW._id;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateTaskTrigger
AFTER UPDATE ON wk.tasks
FOR EACH ROW EXECUTE PROCEDURE wk.onUpdateTask();


CREATE FUNCTION wk.onInsertAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW.typ = 'Task') AND (NEW.isDeleted = FALSE) AND (NEW.state != 'Cancelled') THEN
      UPDATE wk.tasks SET pendingInstances = pendingInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onInsertAnnotationTrigger
AFTER INSERT ON wk.annotations
FOR EACH ROW EXECUTE PROCEDURE wk.onInsertAnnotation();



CREATE OR REPLACE FUNCTION wk.onUpdateAnnotation() RETURNS trigger AS $$
  BEGIN
    IF (NEW._task != OLD._task) OR (NEW.typ != OLD.typ) THEN
        RAISE EXCEPTION 'annotation columns _task and typ are immutable';
    END IF;
    IF (wk.countsAsTaskInstance(OLD) AND NOT wk.countsAsTaskInstance(NEW))
    THEN
      UPDATE wk.tasks SET pendingInstances = pendingInstances + 1 WHERE _id = NEW._task;
    END IF;
    IF (NOT wk.countsAsTaskInstance(OLD) AND wk.countsAsTaskInstance(NEW))
    THEN
      UPDATE wk.tasks SET pendingInstances = pendingInstances - 1 WHERE _id = NEW._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onUpdateAnnotationTrigger
AFTER UPDATE ON wk.annotations
FOR EACH ROW EXECUTE PROCEDURE wk.onUpdateAnnotation();


CREATE FUNCTION wk.onDeleteAnnotation() RETURNS TRIGGER AS $$
  BEGIN
    IF (OLD.typ = 'Task') AND (OLD.isDeleted = FALSE) AND (OLD.state != 'Cancelled') THEN
      UPDATE wk.tasks SET pendingInstances = pendingInstances + 1 WHERE _id = OLD._task;
    END IF;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onDeleteAnnotationTrigger
AFTER DELETE ON wk.annotations
FOR EACH ROW EXECUTE PROCEDURE wk.onDeleteAnnotation();

CREATE FUNCTION wk.enforce_non_negative_balance() RETURNS TRIGGER AS $$
  BEGIN
    -- Assert that the new balance is non-negative
    ASSERT (SELECT COALESCE(SUM(credit_delta), 0) + COALESCE(NEW.credit_delta, 0)
            FROM wk.credit_transactions
            WHERE _organization = NEW._organization AND _id != NEW._id) >= 0, 'Transaction would result in a negative credit balance for organization %', NEW._organization;
    -- Assertion passed, transaction can go ahead
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER enforce_non_negative_balance_trigger
BEFORE INSERT OR UPDATE ON wk.credit_transactions
FOR EACH ROW EXECUTE PROCEDURE wk.enforce_non_negative_balance();

-- ObjectId generation function taken and modified from https://thinhdanggroup.github.io/mongo-id-in-postgresql/
CREATE SEQUENCE wk.objectid_sequence;

CREATE FUNCTION wk.generate_object_id() RETURNS TEXT AS $$
DECLARE
  time_component TEXT;
  machine_id TEXT;
  process_id TEXT;
  counter TEXT;
  result TEXT;
BEGIN
  -- Extract the current timestamp in seconds since the Unix epoch (4 bytes, 8 hex chars)
  SELECT LPAD(TO_HEX(FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT), 8, '0') INTO time_component;
  -- Generate a machine identifier using the hash of the server IP (3 bytes, 6 hex chars)
  SELECT SUBSTRING(md5(CAST(inet_server_addr() AS TEXT)) FROM 1 FOR 6) INTO machine_id;
  -- Retrieve the current backend process ID, limited to 2 bytes (4 hex chars)
  SELECT LPAD(TO_HEX(pg_backend_pid() % 65536), 4, '0') INTO process_id;
  -- Generate a counter using a sequence, ensuring it's 3 bytes (6 hex chars)
  SELECT LPAD(TO_HEX(nextval('wk.objectid_sequence')::BIGINT % 16777216), 6, '0') INTO counter;
  -- Concatenate all parts to form a 24-character ObjectId
  result := time_component || machine_id || process_id || counter;

  RETURN result;
END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION wk.hand_out_monthly_free_credits(free_credits_amount DECIMAL) RETURNS VOID AS $$
DECLARE
    organization_id TEXT;
    next_month_first_day DATE;
    existing_transaction_count INT;
BEGIN
    -- Calculate the first day of the next month
    next_month_first_day := DATE_TRUNC('MONTH', NOW()) + INTERVAL '1 MONTH';

    -- Loop through all organizations
    FOR organization_id IN (SELECT _id FROM wk.organizations) LOOP
        -- Check if there is already a free credit transaction for this organization in the current month
        SELECT COUNT(*) INTO existing_transaction_count
        FROM wk.credit_transactions
        WHERE _organization = organization_id
          AND DATE_TRUNC('MONTH', expiration_date) = next_month_first_day;

        -- Insert free credits only if no record exists for this month
        IF existing_transaction_count = 0 THEN
            INSERT INTO wk.credit_transactions
                (_id, _organization, credit_delta, comment, transaction_state, credit_state, expiration_date)
            VALUES
                (wk.generate_object_id(), organization_id, free_credits_amount,
                 'Free credits for this month', 'Complete', 'Pending', next_month_first_day);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
