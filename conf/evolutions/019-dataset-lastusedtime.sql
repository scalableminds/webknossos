-- https://github.com/scalableminds/webknossos/pull/3014


START TRANSACTION;

CREATE TABLE webknossos.dataSet_lastUsedTimes(
  _dataSet CHAR(24) NOT NULL,
  _user CHAR(24) NOT NULL,
  lastUsedTime TIMESTAMPTZ NOT NULL
);

UPDATE webknossos.releaseInformation SET schemaVersion = 19;

COMMIT TRANSACTION;
