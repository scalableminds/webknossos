/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.webknossos.datastore.binary.api.{BinaryDataService, DataSourceService}
import com.scalableminds.webknossos.datastore.binary.helpers.{DataSourceRepository => AbstractDataSourceRepository}
import com.scalableminds.webknossos.datastore.datastore.services.{AccessTokenService, DataSourceRepository, WebKnossosServer}
import com.scalableminds.webknossos.datastore.datastore.tracings.TracingDataStore
import com.scalableminds.webknossos.datastore.datastore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.datastore.datastore.tracings.volume.VolumeTracingService
import play.api.{Configuration, Environment}

class DataStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("braingames-binary")

  def configure() = {
    bind(classOf[AbstractDataSourceRepository]).to(classOf[DataSourceRepository])
    bind(classOf[AccessTokenService]).asEagerSingleton()
    bind(classOf[ActorSystem]).annotatedWith(Names.named("braingames-binary")).toInstance(system)
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[WebKnossosServer]).asEagerSingleton()
    bind(classOf[SkeletonTracingService]).asEagerSingleton()
    bind(classOf[VolumeTracingService]).asEagerSingleton()
  }
}
