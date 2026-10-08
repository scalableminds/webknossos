START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TYPE webknossos.ALIGNMENT_PROJECT_STATUS AS ENUM ('UPLOADING', 'READY', 'INVALID');

CREATE TABLE webknossos.alignmentProjects(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _organization TEXT NOT NULL,
  _owner TEXT CONSTRAINT _owner_objectId CHECK (_owner ~ '^[0-9a-f]{24}$') NOT NULL,
  _dataStore TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status webknossos.ALIGNMENT_PROJECT_STATUS NOT NULL DEFAULT 'UPLOADING',
  invalidReason TEXT,
  voxelSizeFactor webknossos.VECTOR3 NOT NULL,
  voxelSizeUnit webknossos.LENGTH_UNIT NOT NULL,
  csvPath TEXT, -- relative to the project directory
  fileCount BIGINT,
  totalSizeInBytes BIGINT,
  firstSection INT,
  lastSection INT,
  isInputDataDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT sectionRangeIsValid CHECK (firstSection IS NULL OR lastSection IS NULL OR firstSection <= lastSection)
);

CREATE VIEW webknossos.alignmentProjects_ AS SELECT * FROM webknossos.alignmentProjects WHERE NOT isDeleted;

CREATE UNIQUE INDEX ON webknossos.alignmentProjects(_organization, name) WHERE NOT isDeleted;

ALTER TABLE webknossos.alignmentProjects
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE,
  ADD CONSTRAINT owner_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id) DEFERRABLE,
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE;

DROP VIEW webknossos.jobs_;

ALTER TABLE webknossos.jobs ADD COLUMN _alignmentProject TEXT CONSTRAINT _alignmentProject_objectId CHECK (_alignmentProject ~ '^[0-9a-f]{24}$');

ALTER TABLE webknossos.jobs
  ADD CONSTRAINT alignmentProject_ref FOREIGN KEY(_alignmentProject) REFERENCES webknossos.alignmentProjects(_id) ON DELETE SET NULL DEFERRABLE;

CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

CREATE INDEX ON webknossos.jobs(_alignmentProject);

UPDATE webknossos.releaseInformation SET schemaVersion = 186;

COMMIT TRANSACTION;
