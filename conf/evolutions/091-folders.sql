BEGIN transaction;

-- LICENSE block for the generate_object_id function by https://gist.github.com/jamarparris/6100413:

--The MIT License (MIT)
--Copyright (c) 2013 Jamar Parris

--Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

--The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

--THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

CREATE OR REPLACE FUNCTION webknossos.generate_object_id() RETURNS varchar AS $$
    DECLARE
        time_component bigint;
        machine_id bigint := FLOOR(random() * 16777215);
        process_id bigint;
        seq_id bigint := FLOOR(random() * 16777215);
        result varchar:= '';
    BEGIN
        SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp())) INTO time_component;
        SELECT pg_backend_pid() INTO process_id;

        result := result || lpad(to_hex(time_component), 8, '0');
        result := result || lpad(to_hex(machine_id), 6, '0');
        result := result || lpad(to_hex(process_id), 4, '0');
        result := result || lpad(to_hex(seq_id), 6, '0');
        RETURN result;
    END;
$$ LANGUAGE PLPGSQL;

-- end of MIT-licensed code




CREATE TABLE webknossos.folders(
    _id CHAR(24) PRIMARY KEY,
    name TEXT NOT NULL,
    isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE webknossos.folder_paths(
    _ancestor CHAR(24) NOT NULL,
    _descendant CHAR(24) NOT NULL,
    depth INT NOT NULL,
    PRIMARY KEY(_ancestor, _descendant)
);

CREATE TABLE webknossos.folder_allowedTeams(
  _folder CHAR(24) NOT NULL,
  _team CHAR(24) NOT NULL,
  PRIMARY KEY (_folder, _team)
);

DROP VIEW webknossos.userInfos;
DROP VIEW webknossos.datasets_;
DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.dataSets ADD COLUMN _folder CHAR(24);
ALTER TABLE webknossos.organizations ADD COLUMN _rootFolder CHAR(24);

UPDATE webknossos.organizations SET _rootFolder = webknossos.generate_object_id();

-- insert root folders from the ids just inserted in the organizations table
INSERT INTO webknossos.folders SELECT _rootFolder, 'Datasets', isDeleted from webknossos.organizations;
INSERT INTO webknossos.folder_paths SELECT _id, _id, 0 FROM webknossos.folders;
UPDATE webknossos.datasets d
  SET _folder = o._rootFolder
  FROM webknossos.organizations o
  WHERE d._organization = o._id;

ALTER TABLE webknossos.dataSets ALTER COLUMN _folder SET NOT NULL;
ALTER TABLE webknossos.organizations ALTER COLUMN _rootFolder SET NOT NULL;
ALTER TABLE webknossos.organizations ADD CONSTRAINT organizations__rootfolder_key UNIQUE(_rootFolder);

DROP FUNCTION webknossos.generate_object_id;

ALTER TABLE webknossos.folder_paths
  ADD FOREIGN KEY (_ancestor) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.folder_paths
  ADD FOREIGN KEY (_descendant) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;
ALTER TABLE webknossos.organizations
  ADD FOREIGN KEY (_rootFolder) REFERENCES webknossos.folders(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

CREATE INDEX ON webknossos.dataSets(_folder);

CREATE VIEW webknossos.folders_ as SELECT * FROM webknossos.folders WHERE NOT isDeleted;
CREATE VIEW webknossos.datasets_ as SELECT * FROM webknossos.datasets WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ as SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

CREATE VIEW webknossos.userInfos AS
SELECT
u._id AS _user, m.email, u.firstName, u.lastname, o.displayName AS organization_displayName,
u.isDeactivated, u.isDatasetManager, u.isAdmin, m.isSuperUser,
u._organization, o.name AS organization_name, u.created AS user_created,
m.created AS multiuser_created, u._multiUser, m._lastLoggedInIdentity, u.lastActivity
FROM webknossos.users_ u
JOIN webknossos.organizations_ o ON u._organization = o._id
JOIN webknossos.multiUsers_ m on u._multiUser = m._id;

UPDATE webknossos.releaseInformation SET schemaVersion = 91;

COMMIT;

