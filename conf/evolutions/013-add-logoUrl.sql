-- https://github.com/scalableminds/webknossos/pull/2752

-- UP:


START TRANSACTION;
DROP VIEW webknossos.dataSets_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN logoUrl VARCHAR(2048) NOT NULL DEFAULT '';
ALTER TABLE webknossos.dataSets ADD COLUMN logoUrl VARCHAR(2048);
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
UPDATE webknossos.organizations SET logoUrl = '/assets/images/mpi-logos.svg';
COMMIT TRANSACTION;


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.dataSets_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations DROP COLUMN logoUrl;
ALTER TABLE webknossos.dataSets DROP COLUMN logoUrl;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;
