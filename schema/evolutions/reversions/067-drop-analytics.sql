START TRANSACTION;

CREATE TABLE webknossos.analytics(
  _id CHAR(24) PRIMARY KEY NOT NULL DEFAULT '',
  _user CHAR(24),
  namespace VARCHAR(256) NOT NULL,
  value JSONB NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT valueIsJsonObject CHECK(jsonb_typeof(value) = 'object')
);
CREATE VIEW webknossos.analytics_ AS SELECT * FROM webknossos.analytics WHERE NOT isDeleted;

ALTER TABLE webknossos.analytics
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 66;

COMMIT TRANSACTION;
