-- https://github.com/scalableminds/webknossos/pull/2594 TODO PR number

-- UP:

CREATE TYPE webknossos.CONTACT AS (
  email VARCHAR(265),
  phone VARCHAR(256),
  web VARCHAR(256)
);

CREATE TYPE webknossos.ADDRESS AS (
  street VARCHAR(256),
  town VARCHAR(256)
);

ALTER TABLE webknossos.organizations ADD COLUMN additionalInformation VARCHAR(256);
ALTER TABLE webknossos.organizations ADD COLUMN contact webknossos.CONTACT NOT NULL;
ALTER TABLE webknossos.organizations ADD COLUMN address webknossos.ADDRESS NOT NULL;

-- DOWN:

DROP TYPE webknossos.CONTACT;
DROP TYPE webknossos.ADDRESS;
ALTER TABLE webknossos.organizations DROP COLUMN additionalInformation;
ALTER TABLE webknossos.organizations DROP COLUMN contact;
ALTER TABLE webknossos.organizations DROP COLUMN address;