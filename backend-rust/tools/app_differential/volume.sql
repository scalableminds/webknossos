-- Synthetic volume for performance comparisons, applied identically to wk_diff_play and wk_diff_rust
-- (stack.py reset --volume). Deterministic ids: 'a1' + 22 hex digits so they never collide with
-- seed or generated ObjectIds. Rows are cloned from the Play-seeded sample rows, so every NOT NULL
-- column and enum keeps a value Play itself wrote.
BEGIN;

-- 2000 datasets cloned from l4_sample_remote, with their layers, spread over the seed folder.
INSERT INTO webknossos.datasets
SELECT (jsonb_populate_record(NULL::webknossos.datasets, to_jsonb(d) || jsonb_build_object(
  '_id', 'a1d5' || lpad(to_hex(i), 20, '0'),
  'name', 'volume_dataset_' || i,
  'directoryname', 'volume_dataset_' || i,
  'sharingtoken', NULL,
  '_publication', NULL,
  'created', d.created + i * interval '1 second'
))).*
FROM webknossos.datasets d, generate_series(1, 2000) i
WHERE d._id = '68b80290d4000090f8f4aa62';

INSERT INTO webknossos.dataset_layers
SELECT (jsonb_populate_record(NULL::webknossos.dataset_layers, to_jsonb(l) || jsonb_build_object(
  '_dataset', 'a1d5' || lpad(to_hex(i), 20, '0')
))).*
FROM webknossos.dataset_layers l, generate_series(1, 2000) i
WHERE l._dataset = '68b80290d4000090f8f4aa62';

INSERT INTO webknossos.dataset_mags
SELECT (jsonb_populate_record(NULL::webknossos.dataset_mags, to_jsonb(m) || jsonb_build_object(
  '_dataset', 'a1d5' || lpad(to_hex(i), 20, '0')
))).*
FROM webknossos.dataset_mags m, generate_series(1, 2000) i
WHERE m._dataset = '68b80290d4000090f8f4aa62';

-- 300 users cloned from the non-admin sample user, all members of the Default team.
INSERT INTO webknossos.multiUsers
SELECT (jsonb_populate_record(NULL::webknossos.multiUsers, to_jsonb(m) || jsonb_build_object(
  '_id', 'a1e0' || lpad(to_hex(i), 20, '0'),
  'email', 'volume.user.' || i || '@diff.test',
  'firstname', 'Volume',
  'lastname', 'User ' || i,
  '_lastloggedinidentity', NULL -- set below, once the users exist (circular foreign keys)
))).*
FROM webknossos.multiUsers m, generate_series(1, 300) i
WHERE m._id = '6ad299887e8ea1667bf4110c';

INSERT INTO webknossos.users
SELECT (jsonb_populate_record(NULL::webknossos.users, to_jsonb(u) || jsonb_build_object(
  '_id', 'a1e1' || lpad(to_hex(i), 20, '0'),
  '_multiuser', 'a1e0' || lpad(to_hex(i), 20, '0')
))).*
FROM webknossos.users u, generate_series(1, 300) i
WHERE u._id = '6ad299887e8ea1667bf4110b';

UPDATE webknossos.multiUsers SET _lastLoggedInIdentity = 'a1e1' || substring(_id from 5)
WHERE _id LIKE 'a1e0%';

INSERT INTO webknossos.user_team_roles (_user, _team, isTeamManager)
SELECT 'a1e1' || lpad(to_hex(i), 20, '0'), '6ad299887e8ea1667bf41107', i % 10 = 0
FROM generate_series(1, 300) i;

-- 5000 explorational annotations of the sample admin on the cloned datasets (skeleton layer each).
-- Tracing ids do not exist in FossilDB; only list/report routes may read them.
INSERT INTO webknossos.annotations (_id, _dataset, _user, description, visibility, name, state, tags,
  tracingTime, typ, created, modified)
SELECT 'a1a0' || lpad(to_hex(i), 20, '0'),
       'a1d5' || lpad(to_hex(1 + i % 2000), 20, '0'),
       '6ad299887e8ea1667bf41109', 'volume annotation', 'Internal', 'volume annotation ' || i,
       CASE WHEN i % 5 = 0 THEN 'Finished' ELSE 'Active' END::webknossos.ANNOTATION_STATE,
       ARRAY['volume'], i * 1000, 'Explorational',
       TIMESTAMPTZ '2026-01-01' + i * interval '1 minute', TIMESTAMPTZ '2026-01-01' + i * interval '2 minute'
FROM generate_series(1, 5000) i;

INSERT INTO webknossos.annotation_layers (_annotation, tracingId, typ, name, statistics)
SELECT 'a1a0' || lpad(to_hex(i), 20, '0'),
       '00000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'),
       'Skeleton', 'Skeleton', '{"treeCount": 1, "nodeCount": 10, "edgeCount": 9, "branchPointCount": 0}'
FROM generate_series(1, 5000) i;

COMMIT;
