-- https://github.com/scalableminds/webknossos/pull/5149


START TRANSACTION;

ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT experiencedomains_pkey;
ALTER TABLE webknossos.experienceDomains ADD COLUMN _organization CHAR(24);
UPDATE webknossos.experienceDomains SET _organization = (SELECT _id from webknossos.organizations_ LIMIT 1)
ALTER TABLE webknossos.experienceDomains ALTER COLUMN _organization SET NOT NULL;
ALTER TABLE webknossos.experienceDomains ADD CONSTRAINT experiencedomains_pkey PRIMARY KEY (domain,_organization);

ALTER TABLE webknossos.experienceDomains
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id) DEFERRABLE;

DROP TRIGGER onDeleteAnnotationTrigger ON webknossos.tasks;
DROP TRIGGER onInsertUserExperienceTrigger ON webknossos.user_experiences;

DROP FUNCTION webknossos.onInsertTask;
DROP FUNCTION webknossos.onInsertUserExperience;

UPDATE webknossos.releaseInformation SET schemaVersion = 64;

COMMIT TRANSACTION;
