-- https://github.com/scalableminds/webknossos/pull/3367

START TRANSACTION;

CREATE TABLE webknossos.meshes(
  _id CHAR(24) PRIMARY KEY NOT NULL DEFAULT '',
  _annotation CHAR(24) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position webknossos.VECTOR3 NOT NULL,
  data TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE VIEW webknossos.meshes_ AS SELECT * FROM webknossos.meshes WHERE NOT isDeleted;

ALTER TABLE webknossos.meshes
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 34;

COMMIT TRANSACTION;
