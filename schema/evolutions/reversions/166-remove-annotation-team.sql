START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 166 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN _team TEXT;

-- Task and TracingBase annotations: use the team of the associated project
UPDATE webknossos.annotations a
SET _team = p._team
FROM webknossos.tasks t
JOIN webknossos.projects p ON t._project = p._id
WHERE a._task = t._id
  AND a.typ IN ('Task', 'TracingBase');

-- Explorational annotations: prefer the first team the owner shares with the dataset's allowed teams,
-- falling back to the owner's organization team
UPDATE webknossos.annotations a
SET _team = COALESCE(
  (SELECT utr._team
   FROM webknossos.user_team_roles utr
   JOIN webknossos.dataset_allowedTeams dat ON utr._team = dat._team
   WHERE utr._user = a._user
     AND dat._dataset = a._dataset
   LIMIT 1),
  (SELECT t._id
   FROM webknossos.teams t
   JOIN webknossos.users u ON t._organization = u._organization
   WHERE u._id = a._user
     AND t.isOrganizationTeam = TRUE
     AND NOT t.isDeleted
   LIMIT 1)
)
WHERE a.typ = 'Explorational';

-- Orphan annotations: always use the owner's organization team
UPDATE webknossos.annotations a
SET _team = (
  SELECT t._id
  FROM webknossos.teams t
  JOIN webknossos.users u ON t._organization = u._organization
  WHERE u._id = a._user
    AND t.isOrganizationTeam = TRUE
    AND NOT t.isDeleted
  LIMIT 1
)
WHERE a.typ = 'Orphan';

ALTER TABLE webknossos.annotations
  ALTER COLUMN _team SET NOT NULL,
  ADD CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$'),
  ADD CONSTRAINT annotations__team_fkey FOREIGN KEY (_team) REFERENCES webknossos.teams(_id);

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 165;

COMMIT TRANSACTION;
