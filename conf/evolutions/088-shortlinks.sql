START TRANSACTION;

CREATE TABLE webknossos.shortlinks(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  shortLink CHAR(12) NOT NULL UNIQUE,
  longLink Text NOT NULL
);

CREATE INDEX ON webknossos.shortlinks(shortLink);

UPDATE webknossos.releaseInformation
SET schemaVersion = 88;

COMMIT TRANSACTION;
