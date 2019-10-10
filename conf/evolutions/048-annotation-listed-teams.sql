-- https://github.com/scalableminds/webknossos/pull/X


START TRANSACTION;

CREATE TABLE webknossos.annotation_listedTeams(
  _annotation CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_annotation, _team)
);

UPDATE webknossos.releaseInformation SET schemaVersion = 48;

COMMIT TRANSACTION;
