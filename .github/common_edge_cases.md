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
 - SQL pitfalls:
   - `WHERE x IN ()` with empty array literal (catch empty array in scala before the query): Check that SQL `IN` statements are never called with empty list
   - `ARRAY_AGG(x)` with nullable values (use `ARRAY_REMOVE(ARRAY_AGG(x), null)` instead)
   - check that complex SQL queries have no fan out effect due to multiple left joins
