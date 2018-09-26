package com.scalableminds.webknossos.tracingstore.tracings

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig

class TracingDataStore @Inject()(config: TracingStoreConfig) {

  val healthClient = new FossilDBClient("healthCheckOnly", config)

  healthClient.checkHealth

  lazy val skeletons = new FossilDBClient("skeletons", config)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config)

  lazy val volumes = new FossilDBClient("volumes", config)

  lazy val volumeData = new FossilDBClient("volumeData", config)

}
