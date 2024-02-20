package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.{DataStoreConfig, NativeDracoToStlConverter}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import net.liftweb.common.Box.tryo
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class DSMeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    fullMeshService: FullMeshService,
    dataSourceRepository: DataSourceRepository,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    dsRemoteWebKnossosClient: DSRemoteWebKnossosClient,
    mappingService: MappingService,
    config: DataStoreConfig,
    dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)

  private lazy val converter = new NativeDracoToStlConverter()
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  override def allowRemoteOrigin: Boolean = true

  def testAdHocStl: Action[AnyContent] = Action.async { implicit request =>
    val organizationName = "sample_organization"
    val datasetName = "l4_sample_zarr3_sharded"
    val layerName = "segmentation"
    val segmentId = 1997
    val seedPosition = Vec3Int(3455, 3455, 1023)
    val chunkSize = Vec3Int.full(101)

    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                layerName) ~> NOT_FOUND
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
      before = Instant.now
      verticesNested <- getAllAdHocChunks(
        dataSource,
        segmentationLayer,
        segmentId,
        VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, Vec3Int(4, 4, 1)),
        chunkSize)
      _ = Instant.logSince(before, "adHocMeshing")
      beforeEncoding = Instant.now
      encoded = verticesNested.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = Instant.logSince(beforeEncoding, "transCoding")
    } yield Ok(array)
  }

  private def getAllAdHocChunks(
      dataSource: DataSource,
      segmentationLayer: SegmentationLayer,
      segmentId: Long,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition] = collection.mutable.Set[VoxelPosition]())
    : Fox[List[Array[Float]]] = {
    val adHocMeshRequest = AdHocMeshRequest(
      Some(dataSource),
      segmentationLayer,
      Cuboid(topLeft, chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
      segmentId,
      dataSource.scale,
      None,
      None,
      None
    )
    visited += topLeft
    for {
      (vertices: Array[Float], neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunks(dataSource, segmentationLayer, segmentId, position, chunkSize, visited)
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

  def testStl: Action[AnyContent] = Action.async { implicit request =>
    val organizationName = "sample_organization"
    val datasetName = "l4dense_mesh_test"
    val layerName = "segmentation"
    val meshfileName = "meshfile_4-4-2"
    val listMeshChunksRequest = ListMeshChunksRequest(
      meshfileName,
      55834
    )
    val before = Instant.now
    for {
      chunkInfos: WebknossosSegmentInfo <- meshFileService
        .listMeshChunksForSegmentV3(organizationName, datasetName, layerName, listMeshChunksRequest)
        .toFox
      allChunkRanges: List[MeshChunk] = chunkInfos.chunks.lods.head.chunks
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(organizationName, datasetName, layerName, meshfileName, chunkRange)
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logger.info(s"output size: ${stlOutput.length}. took ${Instant.since(before)}")
    } yield Ok(stlOutput)
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

  private def readMeshChunkAsStl(organizationName: String,
                                 datasetName: String,
                                 layerName: String,
                                 meshfileName: String,
                                 chunkInfo: MeshChunk): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileService.readMeshChunkV3(
        organizationName,
        datasetName,
        layerName,
        MeshChunkDataRequestV3List(meshfileName, List(MeshChunkDataRequestV3(chunkInfo.byteOffset, chunkInfo.byteSize)))
      )
      _ <- bool2Fox(encoding == "draco") ?~> s"meshfile encoding is $encoding, only draco is supported"
      stlEncodedChunk <- tryo(
        converter.dracoToStl(dracoMeshChunkBytes, chunkInfo.position.x, chunkInfo.position.y, chunkInfo.position.z))
    } yield stlEncodedChunk

  private def byteBufferToArray(buf: ByteBuffer, numBytes: Int): Array[Byte] = {
    val arr = new Array[Byte](numBytes)
    buf.rewind()
    buf.get(arr)
    arr
  }

  def listMeshFiles(token: Option[String],
                    organizationName: String,
                    datasetName: String,
                    dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFiles <- meshFileService.exploreMeshFiles(organizationName, datasetName, dataLayerName)
        } yield Ok(Json.toJson(meshFiles))
      }
    }

  def listMeshChunksForSegmentV0(token: Option[String],
                                 organizationName: String,
                                 datasetName: String,
                                 dataLayerName: String): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- meshFileService.listMeshChunksForSegmentV0(organizationName,
                                                                  datasetName,
                                                                  dataLayerName,
                                                                  request.body) ?~> Messages(
            "mesh.file.listChunks.failed",
            request.body.segmentId.toString,
            request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
        } yield Ok(Json.toJson(positions))
      }
    }

  def listMeshChunksForSegmentForVersion(token: Option[String],
                                         organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         formatVersion: Int,
                                         /* If targetMappingName is set, assume that meshfile contains meshes for
                                           the oversegmentation. Collect mesh chunks of all *unmapped* segment ids
                                           belonging to the supplied agglomerate id.
                                           If it is not set, use meshfile as is, assume passed id is present in meshfile
                                          */
                                         targetMappingName: Option[String],
                                         editableMappingTracingId: Option[String]): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          positions <- formatVersion match {
            case 3 =>
              targetMappingName match {
                case None =>
                  meshFileService.listMeshChunksForSegmentV3(organizationName, datasetName, dataLayerName, request.body) ?~> Messages(
                    "mesh.file.listChunks.failed",
                    request.body.segmentId.toString,
                    request.body.meshFile) ?~> Messages("mesh.file.load.failed", request.body.segmentId.toString) ~> BAD_REQUEST
                case Some(mapping) =>
                  for {
                    segmentIds: List[Long] <- segmentIdsForAgglomerateId(organizationName,
                                                                         datasetName,
                                                                         dataLayerName,
                                                                         mapping,
                                                                         editableMappingTracingId,
                                                                         request.body.segmentId,
                                                                         urlOrHeaderToken(token, request))
                    meshChunksForUnmappedSegments = segmentIds.map(
                      segmentId =>
                        meshFileService
                          .listMeshChunksForSegmentV3(organizationName,
                                                      datasetName,
                                                      dataLayerName,
                                                      ListMeshChunksRequest(request.body.meshFile, segmentId))
                          .toOption)
                    meshChunksForUnmappedSegmentsFlat = meshChunksForUnmappedSegments.flatten
                    _ <- bool2Fox(meshChunksForUnmappedSegmentsFlat.nonEmpty) ?~> "zero chunks" ?~> "mesh.file.listChunks.failed"
                    chunkInfos = meshChunksForUnmappedSegmentsFlat.reduce(_.merge(_))
                  } yield chunkInfos
              }
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield Ok(Json.toJson(positions))
      }
    }

  private def segmentIdsForAgglomerateId(organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         mappingName: String,
                                         editableMappingTracingId: Option[String],
                                         agglomerateId: Long,
                                         token: Option[String]): Fox[List[Long]] = {
    val agglomerateFileKey = AgglomerateFileKey(
      organizationName,
      datasetName,
      dataLayerName,
      mappingName
    )
    editableMappingTracingId match {
      case Some(tracingId) =>
        for {
          tracingstoreUri <- dsRemoteWebKnossosClient.getTracingstoreUri
          segmentIdsResult <- dsRemoteTracingstoreClient.getEditableMappingSegmentIdsForAgglomerate(tracingstoreUri,
                                                                                                    tracingId,
                                                                                                    agglomerateId,
                                                                                                    token)
          segmentIds <- if (segmentIdsResult.agglomerateIdIsPresent)
            Fox.successful(segmentIdsResult.segmentIds)
          else
            for {
              agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
              localSegmentIds <- agglomerateService.segmentIdsForAgglomerateId(
                agglomerateFileKey,
                agglomerateId
              )
            } yield localSegmentIds
        } yield segmentIds
      case _ =>
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          segmentIds <- agglomerateService.segmentIdsForAgglomerateId(
            agglomerateFileKey,
            agglomerateId
          )
        } yield segmentIds
    }
  }

  def readMeshChunkV0(token: Option[String],
                      organizationName: String,
                      datasetName: String,
                      dataLayerName: String): Action[MeshChunkDataRequestV0] =
    Action.async(validateJson[MeshChunkDataRequestV0]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- meshFileService.readMeshChunkV0(organizationName,
                                                              datasetName,
                                                              dataLayerName,
                                                              request.body) ?~> "mesh.file.loadChunk.failed"
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def readMeshChunkForVersion(token: Option[String],
                              organizationName: String,
                              datasetName: String,
                              dataLayerName: String,
                              formatVersion: Int): Action[MeshChunkDataRequestV3List] =
    Action.async(validateJson[MeshChunkDataRequestV3List]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (data, encoding) <- formatVersion match {
            case 3 =>
              meshFileService.readMeshChunkV3(organizationName, datasetName, dataLayerName, request.body) ?~> "mesh.file.loadChunk.failed"
            case _ => Fox.failure("Wrong format version") ~> BAD_REQUEST
          }
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def loadFullMesh(token: Option[String],
                   organizationName: String,
                   datasetName: String,
                   dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(datasetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          data: Array[Byte] <- fullMeshService.loadFor(token: Option[String],
                                                       organizationName,
                                                       datasetName,
                                                       dataLayerName,
                                                       request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }
}
