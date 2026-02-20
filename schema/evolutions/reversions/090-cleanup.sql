BEGIN transaction;

-- make datastore reference fields CHAR from VARCHAR

DROP VIEW webknossos.jobs_;
ALTER TABLE webknossos.jobs DROP CONSTRAINT dataStore_ref;
ALTER TABLE webknossos.jobs RENAME COLUMN _dataStore to _dataStoreOLD;
ALTER TABLE webknossos.jobs ADD COLUMN _dataStore CHAR(256) NOT NULL;
UPDATE webknossos.jobs SET _dataStore = _dataStoreOLD;
ALTER TABLE webknossos.jobs DROP COLUMN _dataStoreOLD;
ALTER TABLE webknossos.jobs ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE;
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets DROP CONSTRAINT dataStore_ref;
ALTER TABLE webknossos.dataSets RENAME COLUMN _dataStore to _dataStoreOLD;
ALTER TABLE webknossos.dataSets ADD COLUMN _dataStore CHAR(256) NOT NULL;
UPDATE webknossos.dataSets SET _dataStore = _dataStoreOLD;
ALTER TABLE webknossos.dataSets DROP COLUMN _dataStoreOLD;
ALTER TABLE webknossos.dataSets ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

DROP VIEW webknossos.workers_;
ALTER TABLE webknossos.workers DROP CONSTRAINT dataStore_ref;
ALTER TABLE webknossos.workers RENAME COLUMN _dataStore to _dataStoreOLD;
ALTER TABLE webknossos.workers ADD COLUMN _dataStore CHAR(256) NOT NULL;
UPDATE webknossos.workers SET _dataStore = _dataStoreOLD;
ALTER TABLE webknossos.workers DROP COLUMN _dataStoreOLD;
ALTER TABLE webknossos.workers ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name) DEFERRABLE;
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;

-- add objectid defaults

ALTER TABLE webknossos.annotations ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.meshes ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.meshes ALTER COLUMN _id SET NOT NULL;
ALTER TABLE webknossos.publications ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.dataSets ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.projects ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.scripts ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.taskTypes ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.tasks ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.teams ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.timespans ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.organizations ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.users ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.multiUsers ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.tokens ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.workers ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.jobs ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.invites ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.annotation_privateLinks ALTER COLUMN _id SET DEFAULT '';
ALTER TABLE webknossos.shortLinks ALTER COLUMN _id SET DEFAULT '';

UPDATE webknossos.releaseInformation SET schemaVersion = 89;

COMMIT;

