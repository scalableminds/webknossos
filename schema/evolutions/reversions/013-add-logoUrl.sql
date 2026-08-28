START TRANSACTION;
DROP VIEW webknossos.dataSets_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations DROP COLUMN logoUrl;
ALTER TABLE webknossos.dataSets DROP COLUMN logoUrl;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;
