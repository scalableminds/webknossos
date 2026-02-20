-- https://github.com/scalableminds/webknossos/pull/3281

START TRANSACTION;

CREATE TABLE webknossos.tracingStores(
  name VARCHAR(256) PRIMARY KEY NOT NULL CHECK (name ~* '^[A-Za-z0-9\-_\.]+$'),
  url VARCHAR(512) UNIQUE NOT NULL CHECK (url ~* '^https?://[a-z0-9\.]+.*$'),
  key VARCHAR(1024) NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 30;

COMMIT TRANSACTION;
