-- https://github.com/scalableminds/webknossos/pull/2594 TODO PR number

-- UP:

ALTER TABLE webknossos.organizations ADD COLUMN additionalInformation VARCHAR(256);

-- DOWN:

ALTER TABLE webknossos.organizations DROP COLUMN additionalInformation;