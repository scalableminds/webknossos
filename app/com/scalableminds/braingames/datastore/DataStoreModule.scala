/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.braingames.binary.api.{BinaryDataService, DataSourceService}
import com.scalableminds.braingames.binary.helpers.{DataSourceRepository => AbstractDataSourceRepository}
import com.scalableminds.braingames.datastore.services.{DataSourceRepository, WebKnossosServer}
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import play.api.{Configuration, Environment}

class DataStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("braingames-binary")

  def configure() = {
    bind(classOf[AbstractDataSourceRepository]).to(classOf[DataSourceRepository])
    bind(classOf[ActorSystem]).annotatedWith(Names.named("braingames-binary")).toInstance(system)
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[WebKnossosServer]).asEagerSingleton()
  }
}
