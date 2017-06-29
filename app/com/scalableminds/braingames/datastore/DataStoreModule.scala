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
import com.scalableminds.braingames.datastore.services.{DataSourceRepository, WebKnossosServer}
import play.api.{Configuration, Environment}
import play.api.Play.current

class DataStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("braingames-binary")

  val tracingDataFolder = configuration.getString("braingames.binary.tracingDataFolder").getOrElse("tracingData")
  val tracingDataStore = new VersionedKeyValueStore(new RocksDBStore(tracingDataFolder))

  def configure() = {
    bind(classOf[AbstractDataSourceRepository]).to(classOf[DataSourceRepository])
    bind(classOf[ActorSystem]).annotatedWith(Names.named("braingames-binary")).toInstance(system)
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[VersionedKeyValueStore]).annotatedWith(Names.named("tracing-data-store")).toInstance(tracingDataStore)
    bind(classOf[WebKnossosServer]).asEagerSingleton()
  }
}
