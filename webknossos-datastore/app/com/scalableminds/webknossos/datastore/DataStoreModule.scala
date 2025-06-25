package com.scalableminds.webknossos.datastore

import org.apache.pekko.actor.ActorSystem
import com.google.inject.AbstractModule
import com.google.inject.name.Names
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.connectome.{
  ConnectomeFileService,
  Hdf5ConnectomeFileService,
  ZarrConnectomeFileService
}
import com.scalableminds.webknossos.datastore.services.mesh.{
  AdHocMeshServiceHolder,
  Hdf5MeshFileService,
  MeshFileService,
  NeuroglancerPrecomputedMeshFileService,
  ZarrMeshFileService
}
import com.scalableminds.webknossos.datastore.services.segmentindex.{
  Hdf5SegmentIndexFileService,
  SegmentIndexFileService,
  ZarrSegmentIndexFileService
}
import com.scalableminds.webknossos.datastore.services.uploading.UploadService
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptorService}

class DataStoreModule extends AbstractModule {

  private val actorSystem: ActorSystem = ActorSystem("webknossos-datastore")

  override def configure(): Unit = {
    bind(classOf[DataStoreConfig]).asEagerSingleton()
    bind(classOf[DataStoreAccessTokenService]).asEagerSingleton()
    bind(classOf[ActorSystem]).annotatedWith(Names.named("webknossos-datastore")).toInstance(actorSystem)
    bind(classOf[DataSourceRepository]).asEagerSingleton()
    bind(classOf[UploadService]).asEagerSingleton()
    bind(classOf[DataSourceService]).asEagerSingleton()
    bind(classOf[DataVaultService]).asEagerSingleton()
    bind(classOf[DSRemoteWebknossosClient]).asEagerSingleton()
    bind(classOf[BinaryDataServiceHolder]).asEagerSingleton()
    bind(classOf[MappingService]).asEagerSingleton()
    bind(classOf[AdHocMeshServiceHolder]).asEagerSingleton()
    bind(classOf[ApplicationHealthService]).asEagerSingleton()
    bind(classOf[DSDatasetErrorLoggingService]).asEagerSingleton()
    bind(classOf[MeshFileService]).asEagerSingleton()
    bind(classOf[ZarrMeshFileService]).asEagerSingleton()
    bind(classOf[Hdf5MeshFileService]).asEagerSingleton()
    bind(classOf[AgglomerateService]).asEagerSingleton()
    bind(classOf[ZarrAgglomerateService]).asEagerSingleton()
    bind(classOf[Hdf5AgglomerateService]).asEagerSingleton()
    bind(classOf[SegmentIndexFileService]).asEagerSingleton()
    bind(classOf[ZarrSegmentIndexFileService]).asEagerSingleton()
    bind(classOf[Hdf5SegmentIndexFileService]).asEagerSingleton()
    bind(classOf[ConnectomeFileService]).asEagerSingleton()
    bind(classOf[ZarrConnectomeFileService]).asEagerSingleton()
    bind(classOf[Hdf5ConnectomeFileService]).asEagerSingleton()
    bind(classOf[NeuroglancerPrecomputedMeshFileService]).asEagerSingleton()
    bind(classOf[RemoteSourceDescriptorService]).asEagerSingleton()
    bind(classOf[ChunkCacheService]).asEagerSingleton()
    bind(classOf[DatasetCache]).asEagerSingleton()
  }
}
