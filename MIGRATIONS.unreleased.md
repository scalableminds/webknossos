# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- The config keys in application.conf were restructured. If you overwrite any of them for your config, please adapt to the new structure, according to the table below. If you run any stand-alone datastores or tracingstores, make sure to update their config files as well.

old key | new key | notes
--------|--------|-------
`http.address` | removed | used by play, default is 0.0.0.0, you can still overwrite it if necessary
`actor.defaultTimeout` | removed | was already unused
`js.defaultTimeout` | removed | was already unused
`akka.loggers` | removed | was already unused
`application.name` | removed | was already unused
`application.branch` | removed | was already unused
`application.version` | removed | was already unused
`application.title` | `webKnossos.tabTitle` |
`application.insertInitialData` | `webKnossos.sampleOrganization.enabled` |
`application.insertLocalConnectDatastore` | removed | feature removed, insert manually instead
`application.authentication.defaultuser.email` | `webKnossos.sampleOrganization.user.email` |
`application.authentication.defaultUser.password` | `webKnossos.sampleOrganization.user.password` |
`application.authentication.defaultUser.token` | `webKnossos.sampleOrganization.user.token` |
`application.authentication.defaultUser.isSuperUser` | `webKnossos.sampleOrganization.user.isSuperUser` |
`application.authentication.ssoKey` | `webKnossos.user.ssoKey` |
`application.authentication.inviteExpiry` | `webKnossos.user.inviteExpiry` |
`webKnossos.user.time.tracingPauseInSeconds` | `webKnossos.user.time.tracingPause` | **type changed from Int to FiniteDuration, add ` seconds`**
`webKnossos.query.maxResults` | removed | was already unused
`user.cacheTimeoutInMinutes` | `webKnossos.cache.user.timeout` | **type changed from Int to FiniteDuration, add ` minutes`**
`tracingstore.enabled` | removed | info contained in `play.modules.enabled`
`datastore.enabled` | removed | info contained in `play.modules.enabled`
`datastore.webKnossos.pingIntervalMinutes` | `datastore.webKnossos.pingInterval` | **type changed from Int to FiniteDuration, add ` minutes`**
`braingames.binary.cacheMaxSize` | `datastore.cache.dataCube.maxEntries` |
`braingames.binary.mappingCacheMaxSize` | `datastore.cache.mapping.maxEntries` |
`braingames.binary.agglomerateFileCacheMaxSize` | `datastore.cache.agglomerateFile.maxFileHandleEntries` |
`braingames.binary.agglomerateCacheMaxSize` | `datastore.cache.agglomerateFile.maxSegmentIdEntries` |
`braingames.binary.agglomerateStandardBlockSize` | `datastore.cache.agglomerateFile.blockSize` |
`braingames.binary.agglomerateMaxReaderRange` | `datastore.cache.agglomerateFile.cumsumMaxReaderRange` |
`braingames.binary.loadTimeout` | removed | was already unused
`braingames.binary.saveTimeout` | removed | was already unused
`braingames.binary.isosurfaceTimeout` | `datastore.isosurface.timeout` |  **type changed from Int to FiniteDuration, add ` seconds`**
`braingames.binary.isosurfaceActorPoolSize` | `datastore.isosurface.actorPoolSize` |
`braingames.binary.baseFolder` | `datastore.baseFolder`
`braingames.binary.agglomerateSkeletonEdgeLimit` | `datastore.agglomerateSkeleton.maxEdges`
`braingames.binary.changeHandler.enabled` | `datastore.watchFileSystem.enabled`
`braingames.binary.tickerInterval` | `datastore.watchFileSystem.interval` |  **type changed from Int to FiniteDuration, add ` minutes`**
`mail.enabled` | removed | now enabled if `mail.host` is non-empty
`jobs.username` | `jobs.user` |
`braintracing.active` | `braintracing.enabled`
`braintracing.url` | `braintracing.uri`
`airbrake.apiKey` | removed | was already unused
`airbrake.ssl` | removed | was already unused
`airbrake.enabled` | removed | was already unused
`airbrake.endpoint` | removed | was already unused
`slackNotifications.url` | `slackNotifications.uri` |
`google.analytics.trackingId` | `googleAnalytics.trackingId` |
`operatorData` | `webKnossos.operatorData`

### Postgres Evolutions:
- [070-dark-theme.sql](conf/evolutions/070-dark-theme.sql)
