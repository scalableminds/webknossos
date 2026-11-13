START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.tasks
  ALTER COLUMN neededExperience_domain DROP NOT NULL,
  ALTER COLUMN neededExperience_value DROP NOT NULL,
  ADD CONSTRAINT neededExperienceIsCompleteCheck CHECK ((neededExperience_domain IS NULL) = (neededExperience_value IS NULL));

UPDATE webknossos.releaseInformation SET schemaVersion = 192;

COMMIT TRANSACTION;
