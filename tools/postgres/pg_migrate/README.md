# Data cleanup

## in Postgres

### analytics
* `DELETE FROM webknossos.analytics WHERE _user NOT IN (SELECT _id FROM webknossos.users) AND _user IS NOT NULL;` (1 row, 1 user)

### annotations
* `UPDATE webknossos.annotations SET _task = NULL, typ = 'Orphan' WHERE _id IN (SELECT a._id FROM webknossos.annotations a LEFT OUTER JOIN webknossos.tasks t ON a._task = t._id WHERE t._id IS NULL AND a._task IS NOT NULL);` (takes 20-30s, 193488 rows)
* `UPDATE webknossos.annotations SET _user = '5447d5902d00001c35e1c965' WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (4862 rows, 133 users)

### teams
* `UPDATE webknossos.teams SET _owner = '5447d5902d00001c35e1c965' WHERE _owner NOT IN (SELECT _id FROM webknossos.users);` (2 rows: 'Martin Heß', 'Acker-Palmer')

### timespans
* `DELETE FROM webknossos.timespans WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (9432 rows, 109 users)
* `UPDATE webknossos.timespans SET _annotation = NULL WHERE _id IN (SELECT t._id FROM webknossos.timespans t LEFT OUTER JOIN webknossos.annotations a ON t._annotation = a._id WHERE a._id IS NULL AND t._annotation IS NOT NULL);` (4308 rows)


