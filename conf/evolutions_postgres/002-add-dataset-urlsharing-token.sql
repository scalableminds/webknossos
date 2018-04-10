-- https://github.com/scalableminds/webknossos/pull/2450

-- UP:

START TRANSACTION;

ALTER TABLE webknossos.datasets ADD COLUMN sharingToken CHAR(256);

COMMIT TRANSACTION;


-- DOWN:


ALTER TABLE webknossos.datasets DROP COLUMN sharingToken;
