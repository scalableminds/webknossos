package com.scalableminds.webknossos.tracingstore

import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.webknossos.datastore.services.AdHocMeshServiceHolder
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.{TSDatasetErrorLoggingService, VolumeTracingService}
import com.scalableminds.webknossos.tracingstore.tracings.{TemporaryTracingService, TracingDataStore}
import org.apache.pekko.actor.ActorSystem

class TracingStoreModule extends AbstractModule {

  private val actorSystem: ActorSystem = ActorSystem("webknossos-tracingstore")

  override def configure(): Unit = {
    bind(classOf[ActorSystem]).annotatedWith(Names.named("webknossos-tracingstore")).toInstance(actorSystem)
    bind(classOf[TracingDataStore]).asEagerSingleton()
    bind(classOf[VolumeTracingService]).asEagerSingleton()
    bind(classOf[TracingStoreAccessTokenService]).asEagerSingleton()
    bind(classOf[TSRemoteWebknossosClient]).asEagerSingleton()
    bind(classOf[TSRemoteDatastoreClient]).asEagerSingleton()
    bind(classOf[EditableMappingService]).asEagerSingleton()
    bind(classOf[TSSlackNotificationService]).asEagerSingleton()
    bind(classOf[AdHocMeshServiceHolder]).asEagerSingleton()
    bind(classOf[TSAnnotationService]).asEagerSingleton()
    bind(classOf[TemporaryTracingService]).asEagerSingleton()
    bind(classOf[TSDatasetErrorLoggingService]).asEagerSingleton()
  }

}
