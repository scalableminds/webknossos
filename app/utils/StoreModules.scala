package utils

import javax.inject._

class StoreModules @Inject()(conf: WkConf) {
  def localTracingStoreEnabled: Boolean =
    conf.Play.Modules.enabled.contains("com.scalableminds.webknossos.tracingstore.TracingStoreModule")

  def localDataStoreEnabled: Boolean =
    conf.Play.Modules.enabled.contains("com.scalableminds.webknossos.datastore.DataStoreModule")
}
