DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE EXTENSION pgcrypto;

CREATE DOMAIN OBJECT_ID AS CHAR(24);
CREATE OR REPLACE FUNCTION generate_object_id() RETURNS varchar AS $$
    DECLARE
        time_component bigint;
        machine_id text := encode(gen_random_bytes(3), 'hex');
        process_id bigint;
        seq_id text := encode(gen_random_bytes(3), 'hex');
        result varchar:= '';
    BEGIN
        SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) INTO time_component;
        SELECT pg_backend_pid() INTO process_id;

        result := result || lpad(to_hex(time_component), 8, '0');
        result := result || machine_id;
        result := result || lpad(to_hex(process_id), 4, '0');
        result := result || seq_id;
        RETURN result;
    END;
$$ LANGUAGE PLPGSQL;

CREATE TYPE VECTOR3 AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION
);
CREATE TYPE BOUNDING_BOX AS (
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  width DOUBLE PRECISION,
  height DOUBLE PRECISION,
  depth DOUBLE PRECISION
);

CREATE TABLE analytics(
  _user OBJECT_ID,
  namespace VARCHAR(256) NOT NULL,
  value JSONB NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE ANNOTATION_TRACING_TYPE AS ENUM ('skeleton', 'volume');
CREATE TYPE ANNOTATION_TYPE AS ENUM ('Task', 'Explorational', 'Tracing Base', 'Orphan');
CREATE TYPE ANNOTATION_STATE AS ENUM ('Unassigned', 'Assigned', 'InProgress', 'Finished');
CREATE TABLE annotations(
  _id OBJECT_ID PRIMARY KEY NOT NULL DEFAULT GENERATE_OBJECT_ID(),
  _task OBJECT_ID,
  _team OBJECT_ID NOT NULL,
  _user OBJECT_ID NOT NULL,
  tracing_id UUID NOT NULL, -- UNIQUE,
  tracing_typ ANNOTATION_TRACING_TYPE NOT NULL,
  typ ANNOTATION_TYPE NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  state ANNOTATION_STATE NOT NULL DEFAULT 'Unassigned',
  tags VARCHAR(512)[] NOT NULL DEFAULT '{}',
  statistics JSONB NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  modified TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK ((typ IN ('Tracing Base', 'Task')) = (_task IS NOT NULL))
);

CREATE TABLE datasets(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team OBJECT_ID NOT NULL,
  _datastore VARCHAR(256) NOT NULL ,
  name VARCHAR(256) NOT NULL UNIQUE,
  description TEXT,
  defaultConfiguration JSONB,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (name, _team)
);

CREATE TYPE DATASET_LAYER_CATEGORY AS ENUM ('color', 'mask', 'segmentation');
CREATE TYPE DATASET_LAYER_ELEMENT_CLASS AS ENUM ('uint8', 'uint16', 'uint24', 'uint32');
CREATE TABLE dataset_layers(
  _dataset OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL,
  category DATASET_LAYER_CATEGORY NOT NULL,
  resolutions INT[] NOT NULL DEFAULT '{1}',
  elementClass DATASET_LAYER_ELEMENT_CLASS NOT NULL,
  boundingBox BOUNDING_BOX NOT NULL,
  scale VECTOR3 NOT NULL,
  PRIMARY KEY(_dataset, name)
);

CREATE TABLE dataset_allowedteams(
  _dataset OBJECT_ID NOT NULL,
  _team OBJECT_ID NOT NULL,
  PRIMARY KEY (_dataset, _team)
);

CREATE TYPE DATASTORE_TYPE AS ENUM ('webknossos-store');
CREATE TABLE datastores(
  name VARCHAR(256) PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url VARCHAR(512) UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  key VARCHAR(1024) NOT NULL,
  typ DATASTORE_TYPE NOT NULL DEFAULT 'webknossos-store'
);

CREATE TYPE TASK_LOCATION AS ENUM ('webknossos', 'mturk');
CREATE TABLE projects(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team OBJECT_ID NOT NULL,
  _owner OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^.{3,}$'),
  priority BIGINT NOT NULL DEFAULT 100,
  paused BOOLEAN NOT NULL DEFAULT false,
  expectedTime INTERVAL,
  assignmentConfiguration_location TASK_LOCATION NOT NULL DEFAULT 'webknossos',
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE scripts(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _owner OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  gist VARCHAR(1024) NOT NULL,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (gist ~* '^https?://[a-z0-9\-_\.]+.*$')
);

CREATE TYPE TASKTYPE_MODES AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');
CREATE TABLE tasktypes(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team OBJECT_ID NOT NULL,
  summary VARCHAR(256) NOT NULL UNIQUE,
  description TEXT,
  settings_allowedModes TASKTYPE_MODES[] NOT NULL DEFAULT '{orthogonal, flight, oblique}',
  settings_preferredMode TASKTYPE_MODES DEFAULT 'orthogonal',
  settings_branchPointsAllowed BOOLEAN NOT NULL,
  settings_somaClickingAllowed BOOLEAN NOT NULL,
  settings_advancedOptionsAllowed BOOLEAN NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team OBJECT_ID NOT NULL,
  _project OBJECT_ID NOT NULL,
  _script OBJECT_ID,
  neededExperience_domain VARCHAR(256) NOT NULL CHECK (neededExperience_domain ~* '^.{2,}$'),
  neededExperience_value INT NOT NULL,
  openInstances BIGINT NOT NULL,
  totalInstances BIGINT NOT NULL,
  tracingTime INTERVAL,
  boundingBox BOUNDING_BOX,
  editPosition VECTOR3 NOT NULL,
  editRotation VECTOR3 NOT NULL,
  creationInfo VARCHAR(512),
  isActive BOOLEAN NOT NULL DEFAULT true,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (openInstances <= totalInstances)
);

CREATE TABLE teams(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _owner OBJECT_ID NOT NULL,
  _parent OBJECT_ID,
  name VARCHAR(256) NOT NULL UNIQUE CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  behavesLikeRootTeam BOOLEAN,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE timespans(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _user OBJECT_ID NOT NULL,
  _annotation OBJECT_ID,
  time INTERVAL NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  lastUpdate TIMESTAMP NOT NULL DEFAULT NOW(),
  numberOfUpdates BIGINT NOT NULL DEFAULT 1
);

CREATE TYPE USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');
CREATE TYPE USER_PASSWORDINFO_HASHERS AS ENUM ('scrypt');
CREATE TABLE users(
  _id OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  email VARCHAR(512) NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  firstName VARCHAR(256) NOT NULL, -- CHECK (firstName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastName VARCHAR(256) NOT NULL, -- CHECK (lastName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastActivity TIMESTAMP NOT NULL DEFAULT NOW(),
  userConfiguration JSONB NOT NULL,
  datasetConfigurations JSONB NOT NULL,
  loginInfo_providerID USER_LOGININFO_PROVDERIDS NOT NULL DEFAULT 'credentials',
  loginInfo_providerKey VARCHAR(512) NOT NULL,
  passwordInfo_hasher USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'scrypt',
  passwordInfo_password VARCHAR(512) NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE TEAM_ROLES AS ENUM ('user', 'admin');
CREATE TABLE user_team_roles(
  _user OBJECT_ID NOT NULL,
  _team OBJECT_ID NOT NULL,
  role TEAM_ROLES NOT NULL,
  PRIMARY KEY (_user, _team)
);

CREATE TABLE user_experiences(
  _user OBJECT_ID NOT NULL,
  domain VARCHAR(256) NOT NULL,
  value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (_user, domain)
);

-- ALTER TABLE analytics
--   ADD FOREIGN KEY(_user) REFERENCES users(_id);
-- ALTER TABLE annotations
--   ADD FOREIGN KEY(_task) REFERENCES tasks(_id) ON DELETE SET NULL,
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id),
--   ADD FOREIGN KEY(_user) REFERENCES users(_id);
-- ALTER TABLE datasets
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id),
--   ADD FOREIGN KEY(_datastore) REFERENCES datastores(name);
-- ALTER TABLE dataset_layers
--   ADD FOREIGN KEY(_dataset) REFERENCES datasets(_id) ON DELETE CASCADE;
-- ALTER TABLE datasets_allowedTeams
--   ADD FOREIGN KEY(_dataset) REFERENCES datasets(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id) ON DELETE CASCADE;
-- ALTER TABLE projects
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id),
--   ADD FOREIGN KEY(_owner) REFERENCES users(_id);
-- ALTER TABLE scripts
--   ADD FOREIGN KEY(_owner) REFERENCES users(_id);
-- ALTER TABLE tasktypes
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id) ON DELETE CASCADE;
-- ALTER TABLE tasks
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id),
--   ADD FOREIGN KEY(_project) REFERENCES projects(_id),
--   ADD FOREIGN KEY(_script) REFERENCES scripts(_id) ON DELETE SET NULL;
-- ALTER TABLE teams
--   ADD FOREIGN KEY(_owner) REFERENCES users(_id),
--   ADD FOREIGN KEY(_parent) REFERENCES teams(_id) ON DELETE SET NULL;
-- ALTER TABLE timespans
--   ADD FOREIGN KEY(_user) REFERENCES users(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_annotation) REFERENCES annotations(_id) ON DELETE SET NULL;
-- ALTER TABLE usedannotations
--   ADD FOREIGN KEY(_user) REFERENCES users(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_annotation) REFERENCES annotations(_id) ON DELETE CASCADE;
-- ALTER TABLE user_team_roles
--   ADD FOREIGN KEY(_user) REFERENCES users(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_team) REFERENCES teams(_id) ON DELETE CASCADE;
-- ALTER TABLE user_experiences
--   ADD FOREIGN KEY(_user) REFERENCES users(_id) ON DELETE CASCADE;
