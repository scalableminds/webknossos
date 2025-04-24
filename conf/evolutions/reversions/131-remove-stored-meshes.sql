do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 131, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;


CREATE TABLE webknossos.meshes(
  _id TEXT CONSTRAINT _id_objectId CHECK (_id ~ '^[0-9a-f]{24}$') PRIMARY KEY,
  _annotation TEXT CONSTRAINT _annotation_objectId CHECK (_annotation ~ '^[0-9a-f]{24}$') NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position webknossos.VECTOR3 NOT NULL,
  data TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE VIEW webknossos.meshes_ AS SELECT * FROM webknossos.meshes WHERE NOT isDeleted;

ALTER TABLE webknossos.meshes
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 130;
