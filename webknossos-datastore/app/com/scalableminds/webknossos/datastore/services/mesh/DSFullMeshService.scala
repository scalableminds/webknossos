package com.scalableminds.webknossos.datastore.services.mesh

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.services._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class FullMeshRequest(
    meshFileName: Option[String], // None means ad-hoc meshing
    lod: Option[Int],
    segmentId: Long, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    mappingType: Option[String], // json, agglomerate, editableMapping
    editableMappingTracingId: Option[String],
    mag: Option[Vec3Int], // required for ad-hoc meshing
    seedPosition: Option[Vec3Int], // required for ad-hoc meshing
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    meshFilePath: Option[String], // required for remote neuroglancer precomputed mesh files
    meshFileType: Option[String]
)

object FullMeshRequest {
  implicit val jsonFormat: OFormat[FullMeshRequest] = Json.format[FullMeshRequest]
}

class DSFullMeshService @Inject()(dataSourceRepository: DataSourceRepository,
                                  meshFileService: MeshFileService,
                                  neuroglancerPrecomputedMeshService: NeuroglancerPrecomputedMeshService,
                                  val binaryDataServiceHolder: BinaryDataServiceHolder,
                                  val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
                                  val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
                                  mappingService: MappingService,
                                  config: DataStoreConfig,
                                  adHocMeshServiceHolder: AdHocMeshServiceHolder)
    extends LazyLogging
    with FullMeshHelper
    with MeshMappingHelper {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def loadFor(organizationId: String,
              datasetDirectoryName: String,
              dataLayerName: String,
              fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                m: MessagesProvider,
                                                tc: TokenContext): Fox[Array[Byte]] =
    fullMeshRequest.meshFileName match {
      case Some(_) if fullMeshRequest.meshFilePath.isDefined =>
        loadFullMeshFromRemoteNeuroglancerMeshFile(organizationId, datasetDirectoryName, dataLayerName, fullMeshRequest)
      case Some(_) =>
        loadFullMeshFromMeshfile(organizationId, datasetDirectoryName, dataLayerName, fullMeshRequest)
      case None => loadFullMeshFromAdHoc(organizationId, datasetDirectoryName, dataLayerName, fullMeshRequest)
    }

  private def loadFullMeshFromAdHoc(organizationId: String,
                                    datasetName: String,
                                    dataLayerName: String,
                                    fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                                      m: MessagesProvider,
                                                                      tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.neededForAdHoc"
      seedPosition <- fullMeshRequest.seedPosition.toFox ?~> "seedPosition.neededForAdHoc"
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                datasetName,
                                                                                dataLayerName)
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
      before = Instant.now
      verticesForChunks <- getAllAdHocChunks(dataSource,
                                             segmentationLayer,
                                             fullMeshRequest,
                                             VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
                                             adHocChunkSize)
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = logMeshingDuration(before, "ad-hoc meshing", array.length)
    } yield array

  private def getAllAdHocChunks(
      dataSource: DataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition] = collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Array[Float]]] = {
    val adHocMeshRequest = AdHocMeshRequest(
      Some(dataSource),
      segmentationLayer,
      Cuboid(topLeft, chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
      fullMeshRequest.segmentId,
      dataSource.scale.factor,
      tc,
      fullMeshRequest.mappingName,
      fullMeshRequest.mappingType,
      fullMeshRequest.additionalCoordinates
    )
    visited += topLeft
    for {
      (vertices: Array[Float], neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunks(dataSource, segmentationLayer, fullMeshRequest, position, chunkSize, visited)
      }
      allVertices: List[Array[Float]] = vertices +: neighborVerticesNested.flatten
    } yield allVertices
  }

  private def loadFullMeshFromMeshfile(organizationId: String,
                                       datasetDirectoryName: String,
                                       layerName: String,
                                       fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                                         m: MessagesProvider,
                                                                         tc: TokenContext): Fox[Array[Byte]] =
    for {
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> "meshFileName.needed"
      before = Instant.now
      mappingNameForMeshFile = meshFileService.mappingNameForMeshFile(organizationId,
                                                                      datasetDirectoryName,
                                                                      layerName,
                                                                      meshFileName)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        organizationId,
        datasetDirectoryName,
        layerName,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.segmentId,
        mappingNameForMeshFile,
        omitMissing = false
      )
      chunkInfos: WebknossosSegmentInfo <- meshFileService.listMeshChunksForSegmentsMerged(organizationId,
                                                                                           datasetDirectoryName,
                                                                                           layerName,
                                                                                           meshFileName,
                                                                                           segmentIds)
      allChunkRanges: List[MeshChunk] = chunkInfos.chunks.lods.head.chunks
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(organizationId,
                           datasetDirectoryName,
                           layerName,
                           meshFileName,
                           chunkRange,
                           chunkInfos.transform,
                           None,
                           None,
                           None)
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logMeshingDuration(before, "meshfile", stlOutput.length)
    } yield stlOutput

  private def readMeshChunkAsStl(
      organizationId: String,
      datasetDirectoryName: String,
      layerName: String,
      meshfileName: String,
      chunkInfo: MeshChunk,
      transform: Array[Array[Double]],
      meshFileType: Option[String],
      meshFilePath: Option[String],
      segmentId: Option[Long])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileType match {
        case Some("neuroglancerPrecomputed") =>
          neuroglancerPrecomputedMeshService.readMeshChunkForNeuroglancerPrecomputed(
            meshFilePath,
            Seq(MeshChunkDataRequest(chunkInfo.byteOffset, chunkInfo.byteSize, segmentId))
          ) ?~> "mesh.file.loadChunk.failed"
        case _ =>
          meshFileService.readMeshChunk(
            organizationId,
            datasetDirectoryName,
            layerName,
            MeshChunkDataRequestList(meshfileName,
                                     None,
                                     None,
                                     List(MeshChunkDataRequest(chunkInfo.byteOffset, chunkInfo.byteSize, None)))
          ) ?~> "mesh.file.loadChunk.failed"
      }
      _ <- bool2Fox(encoding == "draco") ?~> s"meshfile encoding is $encoding, only draco is supported"
      scale <- tryo(Vec3Double(transform(0)(0), transform(1)(1), transform(2)(2))) ?~> "could not extract scale from meshfile transform attribute"
      stlEncodedChunk <- tryo(
        dracoToStlConverter.dracoToStl(dracoMeshChunkBytes,
                                       chunkInfo.position.x,
                                       chunkInfo.position.y,
                                       chunkInfo.position.z,
                                       scale.x,
                                       scale.y,
                                       scale.z))
    } yield stlEncodedChunk

  private def loadFullMeshFromRemoteNeuroglancerMeshFile(
      organizationId: String,
      datasetDirectoryName: String,
      layerName: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      // TODO: Mapping, segmentIds
      chunkInfos: WebknossosSegmentInfo <- neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(
        fullMeshRequest.meshFilePath,
        List(fullMeshRequest.segmentId)
      )
      selectedLod = fullMeshRequest.lod.getOrElse(0)
      allChunkRanges: List[MeshChunk] = chunkInfos.chunks.lods(selectedLod).chunks
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> "mesh file name needed"
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(
          organizationId,
          datasetDirectoryName,
          layerName,
          meshFileName,
          chunkRange,
          Array(Array(1, 0, 0), Array(0, 1, 0), Array(0, 0, 1)),
          fullMeshRequest.meshFileType,
          fullMeshRequest.meshFilePath,
          Some(fullMeshRequest.segmentId)
        )
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
    } yield stlOutput

}
