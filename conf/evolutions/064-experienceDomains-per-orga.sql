-- https://github.com/scalableminds/webknossos/pull/5149


START TRANSACTION;

ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT domain_pkey;
ALTER TABLE webknossos.experienceDomains ADD COLUMN _organization CHAR(24) NOT NULL;
ALTER TABLE webknossos.experienceDomains ADD CONSTRAINT domain_orga_pkey PRIMARY KEY (domain,_organization);

DROP TRIGGER onDeleteAnnotationTrigger;
DROP TRIGGER onInsertUserExperienceTrigger;

DROP FUNCTION webknossos.onInsertTask;
DROP FUNCTION webknossos.onInsertUserExperience;

UPDATE webknossos.releaseInformation SET schemaVersion = 64;

COMMIT TRANSACTION;
