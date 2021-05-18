package utils

import javax.inject._

class StoreModules @Inject()(conf: WkConf) {
  def localTracingStoreEnabled: Boolean = {
    val key = "com.scalableminds.webknossos.tracingstore.TracingStoreModule"
    conf.Play.Modules.enabled.contains(key) && !conf.Play.Modules.disabled.contains(key)
  }

  def localDataStoreEnabled: Boolean = {
    val key = "com.scalableminds.webknossos.datastore.DataStoreModule"
    conf.Play.Modules.enabled.contains(key) && !conf.Play.Modules.disabled.contains(key)
  }
}
