-- Fixture data for the wk-auth-poc local dev DB: one organization and one user
-- (poc-user@example.com / poc-password123). Idempotent — safe to re-run.
INSERT INTO webknossos.folders (_id, name)
  VALUES ('35e5e482705e2232e5f54258', 'Root')
  ON CONFLICT DO NOTHING;

INSERT INTO webknossos.organizations (_id, name, _rootFolder)
  VALUES ('poc-org', 'PoC Org', '35e5e482705e2232e5f54258')
  ON CONFLICT DO NOTHING;

-- passwordinfo_password is a real bcrypt hash (version tag normalized to $2a$, as
-- webKnossos's SCrypt/bcrypt wrapper produces) for the plaintext "poc-password123".
INSERT INTO webknossos.multiusers
    (_id, email, passwordinfo_hasher, passwordinfo_password, firstname, lastname, isemailverified)
  VALUES
    ('48d2b06217a7b5638c73bf06', 'poc-user@example.com', 'SCrypt',
     '$2a$10$K/3HPhaGavgsZN6jZHXvSeOEpM2ssdqOEdtgzAWnqYqjFvF0uRCkG', 'Poc', 'User', true)
  ON CONFLICT DO NOTHING;

INSERT INTO webknossos.users (_id, _multiuser, _organization, userconfiguration)
  VALUES ('57fd6743724c987ec848a0a4', '48d2b06217a7b5638c73bf06', 'poc-org', '{}')
  ON CONFLICT DO NOTHING;
