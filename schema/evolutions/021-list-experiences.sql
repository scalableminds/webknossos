-- https://github.com/scalableminds/webknossos/pull/3060

START TRANSACTION;

CREATE TABLE webknossos.experienceDomains(
  domain VARCHAR(256) PRIMARY KEY
);

INSERT INTO webknossos.experienceDomains(domain) SELECT neededExperience_domain FROM webknossos.tasks_ ON CONFLICT DO NOTHING;
INSERT INTO webknossos.experienceDomains(domain) SELECT domain FROM webknossos.user_experiences ON CONFLICT DO NOTHING;


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

UPDATE webknossos.releaseInformation SET schemaVersion = 21;

COMMIT TRANSACTION;
