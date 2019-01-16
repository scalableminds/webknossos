-- https://github.com/scalableminds/webknossos/pull/3625

START TRANSACTION;

DROP VIEW webknossos.dataSets_;

CREATE TABLE webknossos.publications(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  publicationDate TIMESTAMPTZ,
  imageUrl VARCHAR(2048),
  title VARCHAR(2048),
  description TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE webknossos.dataSets ADD COLUMN _publication CHAR(24);
ALTER TABLE webknossos.dataSets ADD COLUMN details JSONB;

CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 37;

COMMIT TRANSACTION;
