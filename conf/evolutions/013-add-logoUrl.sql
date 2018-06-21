-- https://github.com/scalableminds/webknossos/pull/2752

START TRANSACTION;
DROP VIEW webknossos.dataSets_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN logoUrl VARCHAR(2048) NOT NULL DEFAULT '';
ALTER TABLE webknossos.dataSets ADD COLUMN logoUrl VARCHAR(2048);
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
UPDATE webknossos.organizations SET logoUrl = '/assets/images/mpi-logos.svg';
COMMIT TRANSACTION;
