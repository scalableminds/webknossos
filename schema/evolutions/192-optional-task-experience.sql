START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.tasks
  ALTER COLUMN neededExperience_domain DROP NOT NULL,
  ALTER COLUMN neededExperience_value DROP NOT NULL,
  ADD CONSTRAINT neededExperienceIsCompleteCheck CHECK ((neededExperience_domain IS NULL) = (neededExperience_value IS NULL));

-- If the reversion of this evolution ran before, it replaced missing experience requirements with the placeholder
-- 'any_team_member: 0' and gave all users of the affected organizations that experience. Undo this here.
-- On a first run, none of these statements match any rows.
UPDATE webknossos.tasks
  SET neededExperience_domain = NULL, neededExperience_value = NULL
  WHERE neededExperience_domain = 'any_team_member' AND neededExperience_value = 0;

DELETE FROM webknossos.user_experiences WHERE domain = 'any_team_member' AND value = 0;

DELETE FROM webknossos.experienceDomains ed
  WHERE ed.domain = 'any_team_member'
  AND NOT EXISTS (
    SELECT 1 FROM webknossos.tasks t
    JOIN webknossos.projects p ON t._project = p._id
    WHERE t.neededExperience_domain = 'any_team_member' AND p._organization = ed._organization
  );

UPDATE webknossos.releaseInformation SET schemaVersion = 192;

COMMIT TRANSACTION;
