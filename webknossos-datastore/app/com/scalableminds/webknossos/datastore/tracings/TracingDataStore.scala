/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig

class TracingDataStore @Inject()(config: DataStoreConfig) {

  val healthClient = new FossilDBClient("healthCheckOnly", config)

  healthClient.checkHealth

  lazy val skeletons = new FossilDBClient("skeletons", config)

  lazy val skeletonUpdates = new FossilDBClient("skeletonUpdates", config)

  lazy val volumes = new FossilDBClient("volumes", config)

  lazy val volumeData = new FossilDBClient("volumeData", config)

}
