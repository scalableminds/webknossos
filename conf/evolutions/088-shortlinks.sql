START TRANSACTION;

CREATE TABLE webknossos.shortLinks(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  shortLink CHAR(16) NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE INDEX ON webknossos.shortLinks(shortLink);

UPDATE webknossos.releaseInformation
SET schemaVersion = 88;

COMMIT TRANSACTION;
