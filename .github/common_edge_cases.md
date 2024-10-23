# Common edge cases to consider when making significant changes to WEBKNOSSOS.

Will this also work if
 - Mag1 does not exist
 - There are multiple organizations
 - There is only one organization
 - The user is Team Manager, but not Admin/Dataset Manager
 - The annotation is a compound task/project/tasktype annotation
 - The user is logged out and views a public dataset or annotation
 - User uses dark mode / light mode
 - There is no local datastore/tracingstore module (Compare [instructions to test this locally](https://github.com/scalableminds/webknossos/wiki/Set-up-a-standalone-datastore-locally))

Consider SQL pitfalls:
 - `x IN ()` statements must never called with empty list
 - `ARRAY_AGG(x)` may have nullable values (use `ARRAY_REMOVE(ARRAY_AGG(x), null)` instead)
 - Complex SQL queries may have a fanout effect due to multiple left joins, leading to duplicates

When changing the API version, also adapt `ApiVersioning.CURRENT_API_VERSION`
