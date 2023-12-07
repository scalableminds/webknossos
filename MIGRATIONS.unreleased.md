# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...HEAD)
- If your setup contains webknossos-workers, postgres evolution 110 introduces the column `supportedJobCommands`. This needs to be filled in manually for your workers. Currently available job commands are `compute_mesh_file`, `compute_segment_index_file`, `convert_to_wkw`, `export_tiff`, `find_largest_segment_id`, `infer_nuclei`, `infer_neurons`, `materialize_volume_annotation`, `render_animation`. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- If your setup contains webknossos-workers,  postgres evolution 110 introduces the columns `maxParallelHighPriorityJobs` and `maxParallelLowPriorityJobs`. Make sure to set those values to match what you want for your deployment. [#7463](https://github.com/scalableminds/webknossos/pull/7463)

### Postgres Evolutions:

- [110-worker-config.sql](conf/evolutions/110-worker-config.sql)
