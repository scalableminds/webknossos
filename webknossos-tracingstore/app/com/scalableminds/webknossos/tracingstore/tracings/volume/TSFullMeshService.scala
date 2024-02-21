package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{Vec3Double, Vec3Float, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.{VoxelPosition, WebknossosAdHocMeshRequest}
import com.scalableminds.webknossos.datastore.services.{AdHocMeshRequest, FullMeshHelper, FullMeshRequest}
import com.scalableminds.webknossos.tracingstore.tracings.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebKnossosClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject()(volumeTracingService: VolumeTracingService,
                                  editableMappingService: EditableMappingService,
                                  val remoteDatastoreClient: TSRemoteDatastoreClient,
                                  val remoteWebKnossosClient: TSRemoteWebKnossosClient)
    extends FallbackDataHelper
    with FullMeshHelper {

  def loadFor(token: Option[String], tracingId: String, fullMeshRequest: FullMeshRequest)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      tracing <- volumeTracingService.find(tracingId) ?~> "tracing.notFound"
      data <- if (fullMeshRequest.meshFileName.isDefined)
        loadFullMeshFromMeshfile(token, tracing, tracingId, fullMeshRequest)
      else loadFullMeshFromAdHoc(token, tracing, tracingId, fullMeshRequest)
    } yield data

  private def loadFullMeshFromMeshfile(
      token: Option[String],
      tracing: VolumeTracing,
      tracingId: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerFromVolumeTracing(tracing, tracingId)
      fullMeshRequestAdapted = if (tracing.mappingIsEditable.getOrElse(false))
        fullMeshRequest.copy(mappingName = tracing.mappingName,
                             editableMappingTracingId = Some(tracingId),
                             mappingType = Some("HDF5"))
      else fullMeshRequest
      array <- remoteDatastoreClient.loadFullMeshStl(token, remoteFallbackLayer, fullMeshRequestAdapted)
    } yield array

  private def loadFullMeshFromAdHoc(token: Option[String],
                                    tracing: VolumeTracing,
                                    tracingId: String,
                                    fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.neededForAdHoc"
      seedPosition <- fullMeshRequest.seedPosition.toFox ?~> "seedPosition.neededForAdHoc"
      verticesForChunks <- getAllAdHocChunks(token,
                                             tracing,
                                             tracingId,
                                             mag,
                                             fullMeshRequest,
                                             VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
                                             adHocChunkSize)
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
    } yield array

  private def getAllAdHocChunks(
      token: Option[String],
      tracing: VolumeTracing,
      tracingId: String,
      mag: Vec3Int,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition] = collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext): Fox[List[Array[Float]]] = {
    val adHocMeshRequest = WebknossosAdHocMeshRequest(
      position = Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
      mag = mag,
      cubeSize = Vec3Int(chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
      fullMeshRequest.segmentId,
      Vec3Double(1, 2, 3),
      fullMeshRequest.mappingName,
      fullMeshRequest.mappingType,
      fullMeshRequest.additionalCoordinates
    )
    visited += topLeft
    for {
      (vertices: Array[Float], neighbors) <- loadMeshChunkFromAdHoc(token, tracing, adHocMeshRequest, tracingId)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunks(token, tracing, tracingId, mag, fullMeshRequest, position, chunkSize, visited)
      }
      allVertices: List[Array[Float]] = vertices +: neighborVerticesNested.flatten
    } yield allVertices
  }

  private def loadMeshChunkFromAdHoc(token: Option[String],
                                     tracing: VolumeTracing,
                                     adHocMeshRequest: WebknossosAdHocMeshRequest,
                                     tracingId: String): Fox[(Array[Float], List[Int])] =
    if (tracing.mappingIsEditable.getOrElse(false))
      editableMappingService.createAdHocMesh(tracing, tracingId, adHocMeshRequest, token)
    else volumeTracingService.createAdHocMesh(tracingId, adHocMeshRequest, token)
}
