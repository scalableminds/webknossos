BEGIN transaction;

DROP VIEW webknossos.folders_;
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.dataSets DROP COLUMN _folder;
ALTER TABLE webknossos.organizations DROP COLUMN _rootFolder;

DROP TABLE webknossos.folder_paths;
DROP TABLE webknossos.folder_allowedTeams;
DROP TABLE webknossos.folders;

CREATE VIEW webknossos.datasets_ as SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ as SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 90;

COMMIT;

