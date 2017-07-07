/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.google.inject.Inject
import com.scalableminds.braingames.binary.store.kvstore.{RocksDBStore, VersionedKeyValueStore}
import play.api.Configuration
import play.api.inject.ApplicationLifecycle

class TracingDataStore @Inject()(
                                  config: Configuration,
                                  lifecycle:  ApplicationLifecycle
                                )
  extends VersionedKeyValueStore(
    new RocksDBStore(config.getString("braingames.binary.tracingDataFolder").getOrElse("tracingData"),
    List("volumes", "volume-data"))) {

  lifecycle.addStopHook(close _)
}
