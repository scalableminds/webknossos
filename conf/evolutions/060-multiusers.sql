-- https://github.com/scalableminds/webknossos/pull/4984

START TRANSACTION;

-- Access tokens now have to be linked to user via id instead of email
UPDATE webknossos.tokens SET logininfo_providerkey = u._id
FROM (SELECT _id, email FROM webknossos.users) AS u
WHERE webknossos.tokens.logininfo_providerkey = u.email;

DROP VIEW webknossos.users_;

-- We have to generate fake object ids for the new multiUser objects
CREATE FUNCTION generate_object_id() RETURNS varchar AS $$
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

CREATE TABLE webknossos.multiUsers(
  _id CHAR(24) PRIMARY KEY DEFAULT generate_object_id(),
  email VARCHAR(512) NOT NULL UNIQUE CHECK (email ~* '^.+@.+$'),
  passwordInfo_hasher webknossos.USER_PASSWORDINFO_HASHERS NOT NULL DEFAULT 'SCrypt',
  passwordInfo_password VARCHAR(512) NOT NULL,
  isSuperUser BOOLEAN NOT NULL DEFAULT false,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _lastLoggedInIdentity CHAR(24) DEFAULT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

-- For each user, create one multiUser
INSERT INTO webknossos.multiUsers(email, passwordInfo_password, isSuperUser, created, isDeleted)
SELECT email, passwordInfo_password, isSuperUser, created, isDeleted
FROM webknossos.users;

-- In production, the objectIds should be created by the client, not the db.
ALTER TABLE webknossos.multiUsers ALTER COLUMN _id SET DEFAULT '';
DROP FUNCTION generate_object_id;

-- Each user needs to point to its multiUser
ALTER TABLE webknossos.users ADD COLUMN _multiUser CHAR(24);

UPDATE webknossos.users SET _multiUser = m._id
FROM (SELECT _id, email FROM webknossos.multiUsers) AS m
WHERE webknossos.users.email = m.email;

-- Now the constraints can be added
ALTER TABLE webknossos.users ALTER COLUMN _multiUser SET NOT NULL;
ALTER TABLE webknossos.users ADD UNIQUE (_multiUser, _organization);


ALTER TABLE webknossos.users DROP COLUMN email;
ALTER TABLE webknossos.users DROP COLUMN loginInfo_providerID;
ALTER TABLE webknossos.users DROP COLUMN loginInfo_providerKey;
ALTER TABLE webknossos.users DROP COLUMN passwordInfo_hasher;
ALTER TABLE webknossos.users DROP COLUMN passwordInfo_password;
ALTER TABLE webknossos.users DROP COLUMN isSuperUser;

CREATE TABLE webknossos.invites(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  tokenValue Text NOT NULL,
  _organization CHAR(24) NOT NULL,
  autoActivate BOOLEAN NOT NULL,
  expirationDateTime TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX ON webknossos.invites(tokenValue);
CREATE INDEX ON webknossos.multiUsers(email);
CREATE INDEX ON webknossos.users(_multiUser);
CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;

ALTER TABLE webknossos.multiUsers
  ADD CONSTRAINT lastLoggedInIdentity_ref FOREIGN KEY(_lastLoggedInIdentity) REFERENCES webknossos.users(_id) ON DELETE SET NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 60;

COMMIT TRANSACTION;
