DROP SCHEMA webknossos CASCADE;
CREATE SCHEMA webknossos;

CREATE EXTENSION pgcrypto;

CREATE DOMAIN webknossos.OBJECT_ID AS CHAR(24);
CREATE OR REPLACE FUNCTION webknossos.generate_object_id() RETURNS varchar AS $$
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

CREATE TABLE webknossos.analytics(
  _user webknossos.OBJECT_ID,
  namespace VARCHAR(256) NOT NULL,
  value JSONB NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE webknossos.ANNOTATION_TRACING_TYPE AS ENUM ('skeleton', 'volume');
CREATE TYPE webknossos.ANNOTATION_TYPE AS ENUM ('Task', 'Explorational', 'Tracing Base', 'Orphan');
CREATE TYPE webknossos.ANNOTATION_STATE AS ENUM ('Unassigned', 'Assigned', 'InProgress', 'Finished');
CREATE TABLE webknossos.annotations(
  _id webknossos.OBJECT_ID PRIMARY KEY NOT NULL DEFAULT GENERATE_OBJECT_ID(),
  _task webknossos.OBJECT_ID,
  _team webknossos.OBJECT_ID NOT NULL,
  _user webknossos.OBJECT_ID NOT NULL,
  tracing_id UUID NOT NULL, -- UNIQUE,
  tracing_typ webknossos.ANNOTATION_TRACING_TYPE NOT NULL,
  typ webknossos.ANNOTATION_TYPE NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  state webknossos.ANNOTATION_STATE NOT NULL DEFAULT 'Unassigned',
  tags VARCHAR(512)[] NOT NULL DEFAULT '{}',
  statistics JSONB NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  modified TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK ((typ IN ('Tracing Base', 'Task')) = (_task IS NOT NULL))
);

CREATE TABLE webknossos.datasets(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team webknossos.OBJECT_ID NOT NULL,
  _datastore VARCHAR(256) NOT NULL ,
  name VARCHAR(256) NOT NULL UNIQUE,
  description TEXT,
  defaultConfiguration JSONB,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isPublic BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (name, _team)
);

CREATE TYPE webknossos.DATASET_LAYER_CATEGORY AS ENUM ('color', 'mask', 'segmentation');
CREATE TYPE webknossos.DATASET_LAYER_ELEMENT_CLASS AS ENUM ('uint8', 'uint16', 'uint24', 'uint32');
CREATE TABLE webknossos.dataset_layers(
  _dataset webknossos.OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL,
  category webknossos.DATASET_LAYER_CATEGORY NOT NULL,
  resolutions INT[] NOT NULL DEFAULT '{1}',
  elementClass webknossos.DATASET_LAYER_ELEMENT_CLASS NOT NULL,
  boundingBox webknossos.BOUNDING_BOX NOT NULL,
  scale webknossos.VECTOR3 NOT NULL,
  PRIMARY KEY(_dataset, name)
);

CREATE TABLE webknossos.dataset_allowedteams(
  _dataset webknossos.OBJECT_ID NOT NULL,
  _team webknossos.OBJECT_ID NOT NULL,
  PRIMARY KEY (_dataset, _team)
);

CREATE TYPE webknossos.DATASTORE_TYPE AS ENUM ('webknossos-store');
CREATE TABLE webknossos.datastores(
  name VARCHAR(256) PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url VARCHAR(512) UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  key VARCHAR(1024) NOT NULL,
  typ webknossos.DATASTORE_TYPE NOT NULL DEFAULT 'webknossos-store'
);

CREATE TABLE webknossos.projects(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team webknossos.OBJECT_ID NOT NULL,
  _owner webknossos.OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^.{3,}$'),
  priority BIGINT NOT NULL DEFAULT 100,
  paused BOOLEAN NOT NULL DEFAULT false,
  expectedTime INTERVAL,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webknossos.scripts(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _owner webknossos.OBJECT_ID NOT NULL,
  name VARCHAR(256) NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  gist VARCHAR(1024) NOT NULL,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (gist ~* '^https?://[a-z0-9\-_\.]+.*$')
);

CREATE TYPE webknossos.TASKTYPE_MODES AS ENUM ('orthogonal', 'flight', 'oblique', 'volume');
CREATE TABLE webknossos.tasktypes(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team webknossos.OBJECT_ID NOT NULL,
  summary VARCHAR(256) NOT NULL UNIQUE,
  description TEXT,
  settings_allowedModes webknossos.TASKTYPE_MODES[] NOT NULL DEFAULT '{orthogonal, flight, oblique}',
  settings_preferredMode webknossos.TASKTYPE_MODES DEFAULT 'orthogonal',
  settings_branchPointsAllowed BOOLEAN NOT NULL,
  settings_somaClickingAllowed BOOLEAN NOT NULL,
  settings_advancedOptionsAllowed BOOLEAN NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webknossos.tasks(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _team webknossos.OBJECT_ID NOT NULL,
  _project webknossos.OBJECT_ID NOT NULL,
  _script webknossos.OBJECT_ID,
  neededExperience_domain VARCHAR(256) NOT NULL CHECK (neededExperience_domain ~* '^.{2,}$'),
  neededExperience_value INT NOT NULL,
  openInstances BIGINT NOT NULL,
  totalInstances BIGINT NOT NULL,
  tracingTime INTERVAL,
  boundingBox webknossos.BOUNDING_BOX,
  editPosition webknossos.VECTOR3 NOT NULL,
  editRotation webknossos.VECTOR3 NOT NULL,
  creationInfo VARCHAR(512),
  isActive BOOLEAN NOT NULL DEFAULT true,
  created TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (openInstances <= totalInstances)
);

CREATE TABLE webknossos.teams(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _owner webknossos.OBJECT_ID NOT NULL,
  _parent webknossos.OBJECT_ID,
  name VARCHAR(256) NOT NULL UNIQUE CHECK (name ~* '^[A-Za-z0-9\-_\. ß]+$'),
  behavesLikeRootTeam BOOLEAN,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webknossos.timespans(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  _user webknossos.OBJECT_ID NOT NULL,
  _annotation webknossos.OBJECT_ID,
  time INTERVAL NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  lastUpdate TIMESTAMP NOT NULL DEFAULT NOW(),
  numberOfUpdates BIGINT NOT NULL DEFAULT 1
);

CREATE TYPE webknossos.USER_LOGININFO_PROVDERIDS AS ENUM ('credentials');
CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS AS ENUM ('scrypt');
CREATE TABLE webknossos.users(
  _id webknossos.OBJECT_ID PRIMARY KEY DEFAULT GENERATE_OBJECT_ID(),
  email VARCHAR(512) NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  firstName VARCHAR(256) NOT NULL, -- CHECK (firstName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastName VARCHAR(256) NOT NULL, -- CHECK (lastName ~* '^[A-Za-z0-9\-_ ]+$'),
  lastActivity TIMESTAMP NOT NULL DEFAULT NOW(),
  userConfiguration JSONB NOT NULL,
  datasetConfigurations JSONB NOT NULL,
  loginInfo_providerID webknossos.USER_LOGININFO_PROVDERIDS NOT NULL DEFAULT 'credentials',
  loginInfo_providerKey VARCHAR(512) NOT NULL,
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'scrypt',
  passwordInfo_password VARCHAR(512) NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT true,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE webknossos.TEAM_ROLES AS ENUM ('user', 'admin');
CREATE TABLE webknossos.user_team_roles(
  _user webknossos.OBJECT_ID NOT NULL,
  _team webknossos.OBJECT_ID NOT NULL,
  role webknossos.TEAM_ROLES NOT NULL,
  PRIMARY KEY (_user, _team)
);

CREATE TABLE webknossos.user_experiences(
  _user webknossos.OBJECT_ID NOT NULL,
  domain VARCHAR(256) NOT NULL,
  value INT NOT NULL DEFAULT 1,
  PRIMARY KEY (_user, domain)
);


CREATE INDEX ON webknossos.annotations(_user);
CREATE INDEX ON webknossos.annotations(_task);
CREATE INDEX ON webknossos.datasets(name);
CREATE INDEX ON webknossos.tasks(_project);
CREATE INDEX ON webknossos.timespans(_user);
CREATE INDEX ON webknossos.timespans(_annotation);
CREATE INDEX ON webknossos.users(email);


-- ALTER TABLE webknossos.analytics
--   ADD FOREIGN KEY(_user) REFERENCES webknossos.users(_id);
-- ALTER TABLE webknossos.annotations
--   ADD FOREIGN KEY(_task) REFERENCES webknossos.tasks(_id) ON DELETE SET NULL,
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
--   ADD FOREIGN KEY(_user) REFERENCES webknossos.users(_id);
-- ALTER TABLE webknossos.datasets
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
--   ADD FOREIGN KEY(_datastore) REFERENCES webknossos.datastores(name);
-- ALTER TABLE webknossos.dataset_layers
--   ADD FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE;
-- ALTER TABLE webknossos.dataset_allowedTeams
--   ADD FOREIGN KEY(_dataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
-- ALTER TABLE webknossos.projects
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
--   ADD FOREIGN KEY(_owner) REFERENCES webknossos.users(_id);
-- ALTER TABLE webknossos.scripts
--   ADD FOREIGN KEY(_owner) REFERENCES webknossos.users(_id);
-- ALTER TABLE webknossos.tasktypes
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
-- ALTER TABLE webknossos.tasks
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
--   ADD FOREIGN KEY(_project) REFERENCES webknossos.projects(_id),
--   ADD FOREIGN KEY(_script) REFERENCES webknossos.scripts(_id) ON DELETE SET NULL;
-- ALTER TABLE webknossos.teams
--   ADD FOREIGN KEY(_owner) REFERENCES webknossos.users(_id),
--   ADD FOREIGN KEY(_parent) REFERENCES webknossos.teams(_id) ON DELETE SET NULL;
-- ALTER TABLE webknossos.timespans
--   ADD FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE SET NULL;
-- ALTER TABLE webknossos.user_team_roles
--   ADD FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE,
--   ADD FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
-- ALTER TABLE webknossos.user_experiences
--   ADD FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE;
