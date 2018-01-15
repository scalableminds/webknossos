/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.tracings.TracingDataStore
import com.scalableminds.webknossos.datastore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingService
import play.api.{Configuration, Environment}

class DataStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("webknossos-datastore")

  def configure() = {
    bind(classOf[AccessTokenService]).asEagerSingleton()
    bind(classOf[ActorSystem]).annotatedWith(Names.named("webknossos-datastore")).toInstance(system)
    bind(classOf[BinaryDataService]).asEagerSingleton()
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[WebKnossosServer]).asEagerSingleton()
    bind(classOf[SkeletonTracingService]).asEagerSingleton()
    bind(classOf[VolumeTracingService]).asEagerSingleton()
  }
}
