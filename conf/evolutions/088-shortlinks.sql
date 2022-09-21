START TRANSACTION;

CREATE TABLE webknossos.shortLinks(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  key CHAR(16) NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE INDEX ON webknossos.shortLinks(key);

UPDATE webknossos.releaseInformation
SET schemaVersion = 88;

COMMIT TRANSACTION;
