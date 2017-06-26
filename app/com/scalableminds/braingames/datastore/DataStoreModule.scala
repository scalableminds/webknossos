/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.braingames.binary.api.{BinaryDataService, DataSourceService}
import com.scalableminds.braingames.binary.helpers.{DataSourceRepository => AbstractDataSourceRepository}
import com.scalableminds.braingames.binary.store.kvstore.{RocksDBStore, VersionedKeyValueStore}
import com.scalableminds.braingames.datastore.services.{DataSourceRepository, TracingContentService, WebKnossosServer}

class DataStoreModule extends AbstractModule {

  val system = ActorSystem("braingames-binary")

  val tracingDataStore = new VersionedKeyValueStore(new RocksDBStore("tracing-data"))

  def configure() = {
    bind(classOf[ActorSystem]).annotatedWith(Names.named("braingames-binary")).toInstance(system)
    bind(classOf[AbstractDataSourceRepository]).to(classOf[DataSourceRepository])
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[WebKnossosServer]).asEagerSingleton()
    bind(classOf[TracingContentService]).asEagerSingleton()
    bind(classOf[VersionedKeyValueStore]).toInstance(tracingDataStore)
  }
}
