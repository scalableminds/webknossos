# Data cleanup

## in Postgres

### analytics
* `DELETE FROM webknossos.analytics WHERE _user NOT IN (SELECT _id FROM webknossos.users) AND _user IS NOT NULL;` (1 row, 1 user)

### annotations
* in mongo, delete annotations of non-existing datasets (11k) `db.getCollection('annotations').find({}).forEach(function(annotation) {if (db.getCollection('dataSets').findOne({"dataSource.id.name":annotation.dataSetName}) == null) {print(annotation._id + " u: " + annotation._user + " d: " + annotation.dataSetName);}});`
* in mongo, delete annotations with non-existing teams  db.getCollection('annotations').remove({"team":"CajalCourse"})

* delete one of each of the duplicate tracing_id annotations:
   - 542815442c000020b65b8ee0 ("volume tracing for paper")
   - _name: "heiko empty tracings"
   - id: 5440fb1f6c0000143dc7d892
   - id: 5720f085730000414f3d96aa
   - id: 598e9a835f000013923ec2ba

* `UPDATE webknossos.annotations SET _task = NULL, typ = 'Orphan' WHERE _id IN (SELECT a._id FROM webknossos.annotations a LEFT OUTER JOIN webknossos.tasks t ON a._task = t._id WHERE t._id IS NULL AND a._task IS NOT NULL);` (takes 20-30s, 193488 rows)
* `UPDATE webknossos.annotations SET _user = '5447d5902d00001c35e1c965' WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (4862 rows, 133 users)

### teams
* `UPDATE webknossos.teams SET _owner = '5447d5902d00001c35e1c965' WHERE _owner NOT IN (SELECT _id FROM webknossos.users);` (2 rows: 'Martin Heß', 'Acker-Palmer')

### timespans
* `DELETE FROM webknossos.timespans WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (9432 rows, 109 users)
* `UPDATE webknossos.timespans SET _annotation = NULL WHERE _id IN (SELECT t._id FROM webknossos.timespans t LEFT OUTER JOIN webknossos.annotations a ON t._annotation = a._id WHERE a._id IS NULL AND t._annotation IS NOT NULL);` (4308 rows)
