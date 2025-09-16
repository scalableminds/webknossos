package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.services.mesh.{
  DSFullMeshService,
  FullMeshRequest,
  ListMeshChunksRequest,
  MeshChunkDataRequestList,
  MeshFileService,
  MeshMappingHelper
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class DSMeshController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    meshFileService: MeshFileService,
    fullMeshService: DSFullMeshService,
    datasetCache: DatasetCache,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    val binaryDataServiceHolder: BinaryDataServiceHolder
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper {

  override def allowRemoteOrigin: Boolean = true

  def listMeshFiles(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileInfos <- meshFileService.listMeshFiles(dataSource.id, dataLayer)
        } yield Ok(Json.toJson(meshFileInfos))
      }
    }

  def listMeshChunksForSegment(datasetId: ObjectId,
                               dataLayerName: String,
                               /* If targetMappingName is set, assume that meshFile contains meshes for
                                            the oversegmentation. Collect mesh chunks of all *unmapped* segment ids
                                            belonging to the supplied agglomerate id.
                                            If it is not set, use meshFile as is, assume passed id is present in meshFile
                                   Note: in case of an editable mapping, targetMappingName is its baseMapping name.
                                */
                               targetMappingName: Option[String],
                               editableMappingTracingId: Option[String]): Action[ListMeshChunksRequest] =
    Action.async(validateJson[ListMeshChunksRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, request.body.meshFileName)
          mappingNameForMeshFile <- meshFileService.mappingNameForMeshFile(meshFileKey)
          segmentIds: Seq[Long] <- segmentIdsForAgglomerateIdIfNeeded(
            dataSource.id,
            dataLayer,
            targetMappingName,
            editableMappingTracingId,
            request.body.segmentId,
            mappingNameForMeshFile,
            omitMissing = false
          )
          chunkInfos <- meshFileService.listMeshChunksForSegmentsMerged(meshFileKey, segmentIds)
        } yield Ok(Json.toJson(chunkInfos))
      }
    }

  def readMeshChunk(datasetId: ObjectId, dataLayerName: String): Action[MeshChunkDataRequestList] =
    Action.async(validateJson[MeshChunkDataRequestList]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, request.body.meshFileName)
          (data, encoding) <- meshFileService.readMeshChunk(meshFileKey, request.body.requests) ?~> "mesh.file.loadChunk.failed"
        } yield {
          if (encoding.contains("gzip")) {
            Ok(data).withHeaders("Content-Encoding" -> "gzip")
          } else Ok(data)
        }
      }
    }

  def loadFullMeshStl(datasetId: ObjectId, dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          data: Array[Byte] <- fullMeshService.loadFor(dataSource, dataLayer, request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }

  def fullMeshSurfaceArea(datasetId: ObjectId, dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          data: Array[Byte] <- fullMeshService.loadFor(dataSource, dataLayer, request.body) ?~> "mesh.file.loadChunk.failed"
          dataBuffer = ByteBuffer.wrap(data)
          _ = dataBuffer.order(ByteOrder.LITTLE_ENDIAN)
          numberOfTriangles = dataBuffer.getInt(80)
          surface = surfaceFromStlBuffer(dataBuffer, numberOfTriangles)
        } yield Ok(s"$numberOfTriangles triangles, surface $surface")
      }
    }

  private def surfaceFromStlBuffer(dataBuffer: ByteBuffer, numberOfTriangles: Int) = {
    val normalOffset = 12
    var surfaceSum = 0.0f
    val headerOffset = 84
    for (triangleIndex <- 0 until numberOfTriangles) {
      val v1x = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset)
      val v1y = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 0)
      val v1z = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 1)
      val v2x = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 2)
      val v2y = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 3)
      val v2z = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 4)
      val v3x = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 5)
      val v3y = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 6)
      val v3z = dataBuffer.getFloat(headerOffset + triangleIndex + normalOffset + 4 * 7)

      val vec1x = v2x - v1x
      val vec1y = v2y - v1y
      val vec1z = v2z - v1z
      val vec2x = v3x - v1x
      val vec2y = v3y - v1y
      val vec2z = v3z - v1z

      val crossx = vec1y * vec2z - vec1z * vec2y
      val crossy = vec1z * vec2x - vec1x * vec2z
      val crossz = vec1x * vec2y - vec1y * vec2x

      val magnitude = Math.sqrt(crossx * crossx + crossy * crossy + crossz * crossz).toFloat

      surfaceSum = surfaceSum + (magnitude / 2.0f)
    }
    surfaceSum
  }

}
