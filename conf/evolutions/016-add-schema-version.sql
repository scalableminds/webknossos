-- https://github.com/scalableminds/webknossos/pull/2904

-- From now on we store schemaVersion in the database
-- When editing the schema, please update the number both in your evolution and in schema.sql

START TRANSACTION;
CREATE TABLE webknossos.releaseInformation (
  schemaVersion BIGINT NOT NULL
);
INSERT INTO webknossos.releaseInformation(schemaVersion) values(16);
COMMIT TRANSACTION;
