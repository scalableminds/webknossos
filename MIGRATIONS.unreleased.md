# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.07.0...HEAD)

 - Postgres evolution 83 (see below) introduces unique and url-safe constraints for annotation layer names. If the database contains entries violating those new constraints, they need to be fixed manually, otherwise the evolution will abort:
    - change null names to the front-end-side defaults:
        ```
        update webknossos.annotation_layers set name = 'Volume' where name is null and typ = 'Volume'
        update webknossos.annotation_layers set name = 'Skeleton' where name is null and typ = 'Skeleton'
        ```

    - find annotations with multiple layers, make unique manually
        ```
        select _annotation, name from webknossos.annotation_layers where _annotation in (select s._annotation from
        (select _annotation, count(_annotation) from webknossos.annotation_layers where typ = 'Volume' group by _annotation order by count(_annotation) desc limit 1000) as s
        where count > 1) and typ = 'Volume' order by _annotation
        ```

   - find layers with interesting names, manually remove spaces and special characters
        ```
        select * from webknossos.annotation_layers where not name ~* '^[A-Za-z0-9\-_\.]+$'
        ```

### Postgres Evolutions:
- [083-unique-layer-names.sql](conf/evolutions/083-unique-layer-names.sql) Note: Note that this evolution introduces constraints which may not be met by existing data. See above for manual steps
- [084-annotation-contributors.sql](conf/evolutions/084-annotation-contributors.sql)
