START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 125, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

-- Drop views

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.annotations_;
DROP VIEW webknossos.meshes_;
DROP VIEW webknossos.publications_;
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.dataStores_;
DROP VIEW webknossos.tracingStores_;
DROP VIEW webknossos.projects_;
DROP VIEW webknossos.scripts_;
DROP VIEW webknossos.taskTypes_;
DROP VIEW webknossos.tasks_;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.timespans_;
DROP VIEW webknossos.organizations_;
DROP VIEW webknossos.users_;
DROP VIEW webknossos.multiUsers_;
DROP VIEW webknossos.tokens_;
DROP VIEW webknossos.jobs_;
DROP VIEW webknossos.workers_;
DROP VIEW webknossos.invites_;
DROP VIEW webknossos.organizationTeams;
DROP VIEW webknossos.annotation_privateLinks_;
DROP VIEW webknossos.folders_;
DROP VIEW webknossos.credentials_;
DROP VIEW webknossos.maintenances_;
DROP VIEW webknossos.aiModels_;
DROP VIEW webknossos.aiInferences_;

DO $$
  DECLARE
    r RECORD;
    column_type TEXT;
  BEGIN
    FOR r IN
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'webknossos'
        AND data_type IN ('character varying', 'character','character[]','character varying[]')
      LOOP
        IF r.data_type = 'character varying' THEN
          column_type := 'TEXT';
        ELSIF r.data_type = 'character' THEN
          column_type := 'TEXT';
        ELSIF r.data_type LIKE 'character[]' THEN
          column_type := 'TEXT[]';
        ELSIF r.data_type LIKE 'character varying[]' THEN
          column_type := 'TEXT[]';
        END IF;
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN %I SET DATA TYPE %s',
          r.table_schema, r.table_name, r.column_name, column_type
          );
      END LOOP;
  END $$;

-- Recreate views

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;
CREATE VIEW webknossos.meshes_ AS SELECT * FROM webknossos.meshes WHERE NOT isDeleted;
CREATE VIEW webknossos.publications_ AS SELECT * FROM webknossos.publications WHERE NOT isDeleted;
CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.dataStores_ AS SELECT * FROM webknossos.dataStores WHERE NOT isDeleted;
CREATE VIEW webknossos.tracingStores_ AS SELECT * FROM webknossos.tracingStores WHERE NOT isDeleted;
CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.scripts_ AS SELECT * FROM webknossos.scripts WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.timespans_ AS SELECT * FROM webknossos.timespans WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;
CREATE VIEW webknossos.workers_ AS SELECT * FROM webknossos.workers WHERE NOT isDeleted;
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
CREATE VIEW webknossos.annotation_privateLinks_ as SELECT * FROM webknossos.annotation_privateLinks WHERE NOT isDeleted;
CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;
CREATE VIEW webknossos.maintenances_ as SELECT * FROM webknossos.maintenances WHERE NOT isDeleted;
CREATE VIEW webknossos.aiModels_ as SELECT * FROM webknossos.aiModels WHERE NOT isDeleted;
CREATE VIEW webknossos.aiInferences_ as SELECT * FROM webknossos.aiInferences WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
  u._id AS _user, m.email, u.firstName, u.lastname, o.name AS organization_name,
  u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
  u._organization, o._id AS organization_id, u.created AS user_created,
  m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity, m.isEmailVerified
FROM webknossos.users_ u
       JOIN webknossos.organizations_ o ON u._organization = o._id
       JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 126;

COMMIT TRANSACTION;
