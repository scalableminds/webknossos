START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 192 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- The old schema requires a needed experience. Tasks without one get a placeholder experience.
UPDATE webknossos.tasks SET neededExperience_domain = 'none', neededExperience_value = 0 WHERE neededExperience_domain IS NULL;

ALTER TABLE webknossos.tasks
  DROP CONSTRAINT neededExperienceIsCompleteCheck,
  ALTER COLUMN neededExperience_domain SET NOT NULL,
  ALTER COLUMN neededExperience_value SET NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
