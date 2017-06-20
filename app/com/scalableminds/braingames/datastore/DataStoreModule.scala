/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.braingames.binary.api.{BinaryDataService, DataSourceService}
import com.scalableminds.braingames.binary.services.{DataSourceRepository => AbstractDataSourceRepository}
import com.scalableminds.braingames.datastore.services.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer

class DataStoreModule extends AbstractModule {

  val system = ActorSystem("braingames-binary")

  def configure() = {
    bind(classOf[ActorSystem]).annotatedWith(Names.named("braingames-binary")).toInstance(system)
    bind(classOf[AbstractDataSourceRepository]).to(classOf[DataSourceRepository])
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[WebKnossosServer]).asEagerSingleton()
  }
}
