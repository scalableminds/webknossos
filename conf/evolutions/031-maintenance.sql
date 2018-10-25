-- https://github.com/scalableminds/webknossos/pull/3368


START TRANSACTION;


CREATE TABLE webknossos.maintenance(
  maintenanceExpirationTime TIMESTAMPTZ NOT NULL
);
INSERT INTO webknossos.maintenance(maintenanceExpirationTime) values('2000-01-01 00:00:00');


UPDATE webknossos.releaseInformation SET schemaVersion = 31;

COMMIT TRANSACTION;
