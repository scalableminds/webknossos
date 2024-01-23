# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...HEAD)
- The config `setting play.http.secret.key` (secret random string) now requires a minimum length of 32 bytes.
- If your setup contains webknossos-workers, postgres evolution 110 introduces the column `supportedJobCommands`. This needs to be filled in manually for your workers. Currently available job commands are `compute_mesh_file`, `compute_segment_index_file`, `convert_to_wkw`, `export_tiff`, `find_largest_segment_id`, `infer_nuclei`, `infer_neurons`, `materialize_volume_annotation`, `render_animation`. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- If your setup contains webknossos-workers,  postgres evolution 110 introduces the columns `maxParallelHighPriorityJobs` and `maxParallelLowPriorityJobs`. Make sure to set those values to match what you want for your deployment. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- If your setup contains webknossos-workers, you may want to add the new available worker job `compute_segment_index_file` to the `supportedJobCommands` column of one or more of your workers. [#7493](https://github.com/scalableminds/webknossos/pull/7493)
- The WEBKNOSSOS api version has changed to 6. The `isValidNewName` route for datasets now returns 200 regardless of whether the name is valid or not. The body contains a JSON object with the key "isValid". [#7550](https://github.com/scalableminds/webknossos/pull/7550)
- If your setup contains ND datasets, run the python3 script at `tools/migrate-axis-bounds/migration.py` on your datastores to update the datasource-properties.jsons of the ND datasets.

### Postgres Evolutions:

- [110-worker-config.sql](conf/evolutions/110-worker-config.sql)
