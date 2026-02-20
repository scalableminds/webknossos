-- https://github.com/scalableminds/webknossos/pull/5149


START TRANSACTION;

ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT primarykey__domain_orga;
ALTER TABLE webknossos.experienceDomains DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.experienceDomains DROP COLUMN _organization;
ALTER TABLE webknossos.experienceDomains ADD CONSTRAINT experiencedomains_pkey PRIMARY KEY (domain);

CREATE FUNCTION webknossos.onInsertTask() RETURNS trigger AS $$
  BEGIN
    INSERT INTO webknossos.experienceDomains(domain) values(NEW.neededExperience_domain) ON CONFLICT DO NOTHING;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION webknossos.onInsertUserExperience() RETURNS trigger AS $$
  BEGIN
    INSERT INTO webknossos.experienceDomains(domain) values(NEW.domain) ON CONFLICT DO NOTHING;
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER onDeleteAnnotationTrigger
AFTER INSERT ON webknossos.tasks
FOR EACH ROW EXECUTE PROCEDURE webknossos.onInsertTask();

CREATE TRIGGER onInsertUserExperienceTrigger
AFTER INSERT ON webknossos.user_experiences
FOR EACH ROW EXECUTE PROCEDURE webknossos.onInsertUserExperience();

UPDATE webknossos.releaseInformation SET schemaVersion = 63;

COMMIT TRANSACTION;
