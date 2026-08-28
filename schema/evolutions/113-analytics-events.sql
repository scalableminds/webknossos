START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 112, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TABLE webknossos.analyticsEvents(
  _id CHAR(24) PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessionId BIGINT NOT NULL,
  eventType VARCHAR(512) NOT NULL,
  eventProperties JSONB NOT NULL,
  _user CHAR(24) NOT NULL,
  _organization CHAR(24) NOT NULL,
  isOrganizationAdmin BOOLEAN NOT NULL,
  isSuperUser BOOLEAN NOT NULL,
  webknossosUri VARCHAR(512) NOT NULL,
  CONSTRAINT eventProperties CHECK(jsonb_typeof(eventProperties) = 'object')
);

UPDATE webknossos.releaseInformation SET schemaVersion = 113;

COMMIT TRANSACTION;
