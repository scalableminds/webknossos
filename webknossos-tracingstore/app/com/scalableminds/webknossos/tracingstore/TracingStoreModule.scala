package com.scalableminds.webknossos.tracingstore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import play.api.{Configuration, Environment}
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

class TracingStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("webknossos-tracingstore")

  override def configure() = {
    bind(classOf[ActorSystem]).annotatedWith(Names.named("webknossos-tracingstore")).toInstance(system)
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[VolumeTracingService]).asEagerSingleton()
    bind(classOf[TracingStoreAccessTokenService]).asEagerSingleton()
    bind(classOf[TracingStoreWkRpcClient]).asEagerSingleton()
    bind(classOf[SkeletonTracingService]).asEagerSingleton()
  }
}
