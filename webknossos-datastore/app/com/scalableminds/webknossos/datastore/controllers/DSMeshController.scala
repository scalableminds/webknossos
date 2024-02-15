package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.{DataStoreConfig, NativeDracoToStlConverter}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, SegmentationLayer}
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

    for {
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                layerName) ~> NOT_FOUND
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
      adHocMeshRequest = AdHocMeshRequest(
        Some(dataSource),
        segmentationLayer,
        Cuboid(VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, Vec3Int(4, 4, 1)), 33, 33, 129),
        segmentId,
        Vec3Int.ones,
        dataSource.scale,
        None,
        None,
        None
      )
      // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
      // consecutive 3D points (i.e., nine floats) form a triangle.
      // There are no shared vertices between triangles.
      (vertices, neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      numFaces = vertices.length / (3 * 3) // a face has three vertices, a vertex has three floats.
      _ = logger.info(s"returned ${vertices.length} floats describing the vertices of $numFaces faces.")
      constantStlHeader = Array.fill[Byte](80)(0)
      outputNumBytes = 80 + 4 + numFaces * 50
      output = ByteBuffer.allocate(outputNumBytes).order(ByteOrder.LITTLE_ENDIAN)
      unused = Array.fill[Byte](2)(0)
      _ = output.put(constantStlHeader)
      _ = output.putInt(numFaces)
      _ = for (faceIndex <- 0 until numFaces) {
        val v1 = Vec3Float(vertices(faceIndex), vertices(faceIndex + 1), vertices(faceIndex + 2))
        val v2 = Vec3Float(vertices(faceIndex + 3), vertices(faceIndex + 4), vertices(faceIndex + 5))
        val v3 = Vec3Float(vertices(faceIndex + 6), vertices(faceIndex + 7), vertices(faceIndex + 8))
        val norm = Vec3Float.crossProduct(v2 - v1, v3 - v1).normalize
        output.putFloat(norm.x)
        output.putFloat(norm.y)
        output.putFloat(norm.z)
        for (vertexIndex <- 0 until 3) {
          for (dimIndex <- 0 until 3) {
            output.putFloat(vertices(9 * faceIndex + 3 * vertexIndex + dimIndex))
          }
        }
        output.put(unused)
      }
      array = byteBufferToArray(output, outputNumBytes)
    } yield Ok(array)
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
