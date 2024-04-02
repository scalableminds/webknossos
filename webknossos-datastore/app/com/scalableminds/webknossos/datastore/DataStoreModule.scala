package com.scalableminds.webknossos.datastore

import org.apache.pekko.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.uploading.UploadService
import com.scalableminds.webknossos.datastore.storage.DataVaultService

class DataStoreModule extends AbstractModule {

  val system: ActorSystem = ActorSystem("webknossos-datastore")

  override def configure(): Unit = {
    bind(classOf[DataStoreConfig]).asEagerSingleton()
    bind(classOf[DataStoreAccessTokenService]).asEagerSingleton()
    bind(classOf[ActorSystem]).annotatedWith(Names.named("webknossos-datastore")).toInstance(system)
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[UploadService]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[DataVaultService]).asEagerSingleton()
    bind(classOf[DSRemoteWebknossosClient]).asEagerSingleton()
    bind(classOf[BinaryDataServiceHolder]).asEagerSingleton()
    bind(classOf[MappingService]).asEagerSingleton()
    bind(classOf[AgglomerateService]).asEagerSingleton()
    bind(classOf[AdHocMeshServiceHolder]).asEagerSingleton()
    bind(classOf[ApplicationHealthService]).asEagerSingleton()
    bind(classOf[DatasetErrorLoggingService]).asEagerSingleton()
  }
}
