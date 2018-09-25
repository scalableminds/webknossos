package com.scalableminds.webknossos.tracingstore

import akka.actor.ActorSystem
import com.google.inject.AbstractModule
import play.api.{Configuration, Environment}
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.SkeletonTracingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService

class TracingStoreModule(environment: Environment, configuration: Configuration) extends AbstractModule {

  val system = ActorSystem("webknossos-tracingstore")

  def configure() = {
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[SkeletonTracingService]).asEagerSingleton()
    bind(classOf[VolumeTracingService]).asEagerSingleton()
  }
}
