package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.{DataStoreConfig, NativeDracoToStlConverter}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}

import java.nio.{ByteBuffer, ByteOrder}
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
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
)

object FullMeshRequest {
  implicit val jsonFormat: OFormat[FullMeshRequest] = Json.format[FullMeshRequest]
}

class FullMeshService @Inject()(dataSourceRepository: DataSourceRepository,
                                meshFileService: MeshFileService,
                                val binaryDataServiceHolder: BinaryDataServiceHolder,
                                val dsRemoteWebKnossosClient: DSRemoteWebknossosClient,
                                val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
                                mappingService: MappingService,
                                config: DataStoreConfig,
                                adHocMeshServiceHolder: AdHocMeshServiceHolder)
    extends LazyLogging
    with MeshMappingHelper {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  private lazy val dracoToStlConverter = new NativeDracoToStlConverter()

  private lazy val adHocChunkSize = Vec3Int(100, 100, 100)

  def loadFor(token: Option[String],
              organizationName: String,
              datasetName: String,
              dataLayerName: String,
              fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, m: MessagesProvider): Fox[Array[Byte]] =
    fullMeshRequest.meshFileName match {
      case Some(_) =>
        loadFullMeshFromMeshfile(token, organizationName, datasetName, dataLayerName, fullMeshRequest)
      case None => loadFullMeshFromAdHoc(token, organizationName, datasetName, dataLayerName, fullMeshRequest)
    }

  private def loadFullMeshFromAdHoc(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, m: MessagesProvider): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.neededForAdHoc"
      seedPosition <- fullMeshRequest.seedPosition.toFox ?~> "seedPosition.neededForAdHoc"
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                dataLayerName)
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
      before = Instant.now
      verticesForChunks <- getAllAdHocChunks(dataSource,
                                             segmentationLayer,
                                             fullMeshRequest,
                                             VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
                                             adHocChunkSize)
      _ = Instant.logSince(before, "adHocMeshing")
      beforeEncoding = Instant.now
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = Instant.logSince(beforeEncoding, "transCoding")
    } yield array

  private def getAllAdHocChunks(
      dataSource: DataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition] = collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext): Fox[List[Array[Float]]] = {
    val adHocMeshRequest = AdHocMeshRequest(
      Some(dataSource),
      segmentationLayer,
      Cuboid(topLeft, chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
      fullMeshRequest.segmentId,
      dataSource.scale,
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

  private def generateNextTopLeftsFromNeighbors(oldTopLeft: VoxelPosition,
                                                neighborIds: List[Int],
                                                chunkSize: Vec3Int,
                                                visited: collection.mutable.Set[VoxelPosition]): List[VoxelPosition] = {
    // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
    val neighborLookup = Seq(
      Vec3Int(0, 0, -1),
      Vec3Int(0, -1, 0),
      Vec3Int(-1, 0, 0),
      Vec3Int(0, 0, 1),
      Vec3Int(0, 1, 0),
      Vec3Int(1, 0, 0),
    )
    val neighborPositions = neighborIds.map { neighborId =>
      val neighborMultiplier = neighborLookup(neighborId)
      oldTopLeft.move(neighborMultiplier.x * chunkSize.x * oldTopLeft.mag.x,
                      neighborMultiplier.y * chunkSize.y * oldTopLeft.mag.y,
                      neighborMultiplier.z * chunkSize.z * oldTopLeft.mag.z)
    }
    neighborPositions.filterNot(visited.contains)
  }

  private def adHocMeshToStl(vertexBuffer: Array[Float]): Array[Byte] = {
    val numFaces = vertexBuffer.length / (3 * 3) // a face has three vertices, a vertex has three floats.
    val outputNumBytes = numFaces * 50
    val output = ByteBuffer.allocate(outputNumBytes).order(ByteOrder.LITTLE_ENDIAN)
    val unused = Array.fill[Byte](2)(0)
    for (faceIndex <- 0 until numFaces) {
      val v1 = Vec3Float(vertexBuffer(faceIndex), vertexBuffer(faceIndex + 1), vertexBuffer(faceIndex + 2))
      val v2 = Vec3Float(vertexBuffer(faceIndex + 3), vertexBuffer(faceIndex + 4), vertexBuffer(faceIndex + 5))
      val v3 = Vec3Float(vertexBuffer(faceIndex + 6), vertexBuffer(faceIndex + 7), vertexBuffer(faceIndex + 8))
      val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
      output.putFloat(norm.x)
      output.putFloat(norm.y)
      output.putFloat(norm.z)
      for (vertexIndex <- 0 until 3) {
        for (dimIndex <- 0 until 3) {
          output.putFloat(vertexBuffer(9 * faceIndex + 3 * vertexIndex + dimIndex))
        }
      }
      output.put(unused)
    }
    byteBufferToArray(output, outputNumBytes)
  }

  private def loadFullMeshFromMeshfile(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      layerName: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> "meshFileName.needed"
      before = Instant.now
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(organizationName,
                                                       datasetName,
                                                       layerName,
                                                       fullMeshRequest.mappingName,
                                                       fullMeshRequest.editableMappingTracingId,
                                                       fullMeshRequest.segmentId,
                                                       token)
      chunkInfos <- meshFileService.listMeshChunksForSegmentsV3(organizationName,
                                                                datasetName,
                                                                layerName,
                                                                meshFileName,
                                                                segmentIds)
      allChunkRanges: List[MeshChunk] = chunkInfos.chunks.lods.head.chunks
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(organizationName, datasetName, layerName, meshFileName, chunkRange)
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logger.info(s"output size: ${stlOutput.length}. took ${Instant.since(before)}")
    } yield stlOutput

  private def readMeshChunkAsStl(organizationName: String,
                                 datasetName: String,
                                 layerName: String,
                                 meshfileName: String,
                                 chunkInfo: MeshChunk)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileService.readMeshChunkV3(
        organizationName,
        datasetName,
        layerName,
        MeshChunkDataRequestV3List(meshfileName, List(MeshChunkDataRequestV3(chunkInfo.byteOffset, chunkInfo.byteSize)))
      )
      _ <- bool2Fox(encoding == "draco") ?~> s"meshfile encoding is $encoding, only draco is supported"
      stlEncodedChunk <- tryo(
        dracoToStlConverter
          .dracoToStl(dracoMeshChunkBytes, chunkInfo.position.x, chunkInfo.position.y, chunkInfo.position.z))
    } yield stlEncodedChunk

  private def byteBufferToArray(buf: ByteBuffer, numBytes: Int): Array[Byte] = {
    val arr = new Array[Byte](numBytes)
    buf.rewind()
    buf.get(arr)
    arr
  }

  private def combineEncodedChunksToStl(stlEncodedChunks: Seq[Array[Byte]]): Array[Byte] = {
    val numFaces = stlEncodedChunks.map(_.length / 50).sum // our stl implementation writes exactly 50 bytes per face
    val constantStlHeader = Array.fill[Byte](80)(0)
    val outputNumBytes = 80 + 4 + stlEncodedChunks.map(_.length).sum
    val output = ByteBuffer.allocate(outputNumBytes).order(ByteOrder.LITTLE_ENDIAN)
    output.put(constantStlHeader)
    output.putInt(numFaces)
    stlEncodedChunks.foreach(output.put)
    byteBufferToArray(output, outputNumBytes)
  }
}
