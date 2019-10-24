-- https://github.com/scalableminds/webknossos/pull/4304


START TRANSACTION;

CREATE TABLE webknossos.annotation_listedTeams(
  _annotation CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_annotation, _team)
);

ALTER TABLE webknossos.annotation_listedTeams
    ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE CASCADE DEFERRABLE,
    ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 49;

COMMIT TRANSACTION;
