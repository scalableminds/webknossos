START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 113, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TYPE webknossos.AI_MODEL_CATEGORY AS ENUM ('em_neurons', 'em_nuclei');

CREATE TABLE webknossos.aiModels(
  _id CHAR(24) PRIMARY KEY,
  _organization CHAR(24) NOT NULL,
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
  _organization CHAR(24) NOT NULL,
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

DROP VIEW webknossos.jobs_;
ALTER TABLE webknossos.jobs ADD COLUMN _voxelytics_workflowHash VARCHAR(512);
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;

ALTER TABLE webknossos.aiModels
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_dataStore) REFERENCES webknossos.datastores(name) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_trainingJob) REFERENCES webknossos.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiInferences
  ADD FOREIGN KEY (_organization) REFERENCES webknossos.organizations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_newDataset) REFERENCES webknossos.datasets(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_inferenceJob) REFERENCES webknossos.jobs(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.aiModel_trainingAnnotations
  ADD FOREIGN KEY (_aiModel) REFERENCES webknossos.aiModels(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  ADD FOREIGN KEY (_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 114;

COMMIT TRANSACTION;
