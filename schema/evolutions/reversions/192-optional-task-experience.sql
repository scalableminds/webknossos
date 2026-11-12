START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 192 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- The old schema requires a needed experience. Tasks without one get the placeholder experience 'any_team_member: 0'.
-- To keep them assignable, every user of the affected organizations gets that experience as well.
-- Note that users created after this reversion do not get it automatically.
CREATE TEMPORARY TABLE affectedOrganizations ON COMMIT DROP AS
  SELECT DISTINCT p._organization
  FROM webknossos.tasks t
  JOIN webknossos.projects p ON t._project = p._id
  WHERE t.neededExperience_domain IS NULL;

INSERT INTO webknossos.experienceDomains(domain, _organization)
  SELECT 'any_team_member', _organization FROM affectedOrganizations
  ON CONFLICT DO NOTHING;

INSERT INTO webknossos.user_experiences(_user, domain, value)
  SELECT u._id, 'any_team_member', 0
  FROM webknossos.users u
  WHERE u._organization IN (SELECT _organization FROM affectedOrganizations)
  ON CONFLICT (_user, domain) DO UPDATE SET value = GREATEST(webknossos.user_experiences.value, 0);

UPDATE webknossos.tasks SET neededExperience_domain = 'any_team_member', neededExperience_value = 0 WHERE neededExperience_domain IS NULL;

ALTER TABLE webknossos.tasks
  DROP CONSTRAINT neededExperienceIsCompleteCheck,
  ALTER COLUMN neededExperience_domain SET NOT NULL,
  ALTER COLUMN neededExperience_value SET NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 191;

COMMIT TRANSACTION;
