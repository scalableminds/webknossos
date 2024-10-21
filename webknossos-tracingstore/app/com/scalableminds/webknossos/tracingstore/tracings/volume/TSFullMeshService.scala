package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.ListOfVec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer}
import com.scalableminds.webknossos.datastore.models.{
  BucketPosition,
  VoxelPosition,
  VoxelSize,
  WebknossosAdHocMeshRequest
}
import com.scalableminds.webknossos.datastore.services.{FullMeshHelper, FullMeshRequest}
import com.scalableminds.webknossos.tracingstore.tracings.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject()(volumeTracingService: VolumeTracingService,
                                  editableMappingService: EditableMappingService,
                                  volumeSegmentIndexService: VolumeSegmentIndexService,
                                  val remoteDatastoreClient: TSRemoteDatastoreClient,
                                  val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends FallbackDataHelper
    with ProtoGeometryImplicits
    with FullMeshHelper
    with LazyLogging {

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
      baseMappingName <- volumeTracingService.baseMappingName(tracing)
      fullMeshRequestAdapted = if (tracing.getHasEditableMapping)
        fullMeshRequest.copy(mappingName = baseMappingName,
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
      _ <- bool2Fox(tracing.mags.contains(vec3IntToProto(mag))) ?~> "mag.notPresentInTracing"
      before = Instant.now
      voxelSize <- remoteDatastoreClient.voxelSizeForTracingWithCache(tracingId, token) ?~> "voxelSize.failedToFetch"
      verticesForChunks <- if (tracing.hasSegmentIndex.getOrElse(false))
        getAllAdHocChunksWithSegmentIndex(token, tracing, tracingId, mag, voxelSize, fullMeshRequest)
      else
        getAllAdHocChunksWithNeighborLogic(token,
                                           tracing,
                                           tracingId,
                                           mag,
                                           voxelSize,
                                           fullMeshRequest,
                                           fullMeshRequest.seedPosition.map(sp => VoxelPosition(sp.x, sp.y, sp.z, mag)),
                                           adHocChunkSize)
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = logMeshingDuration(before, "ad-hoc meshing (tracingstore)", array.length)
    } yield array

  private def getAllAdHocChunksWithSegmentIndex(
      token: Option[String],
      tracing: VolumeTracing,
      tracingId: String,
      mag: Vec3Int,
      voxelSize: VoxelSize,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[List[Array[Float]]] =
    for {
      fallbackLayer <- volumeTracingService.getFallbackLayer(tracingId)
      mappingName <- volumeTracingService.baseMappingName(tracing)
      bucketPositionsRaw: ListOfVec3IntProto <- volumeSegmentIndexService
        .getSegmentToBucketIndexWithEmptyFallbackWithoutBuffer(
          fallbackLayer,
          tracingId,
          fullMeshRequest.segmentId,
          mag,
          version = None,
          mappingName = mappingName,
          editableMappingTracingId = volumeTracingService.editableMappingTracingId(tracing, tracingId),
          fullMeshRequest.additionalCoordinates,
          AdditionalAxis.fromProtosAsOpt(tracing.additionalAxes),
          token
        )
      bucketPositions = bucketPositionsRaw.values
        .map(vec3IntFromProto)
        .map(_ * mag * DataLayer.bucketLength)
        .map(bp => BucketPosition(bp.x, bp.y, bp.z, mag, fullMeshRequest.additionalCoordinates))
        .toList
      vertexChunksWithNeighbors: List[(Array[Float], List[Int])] <- Fox.serialCombined(bucketPositions) {
        bucketPosition =>
          val adHocMeshRequest = WebknossosAdHocMeshRequest(
            position = Vec3Int(bucketPosition.voxelMag1X, bucketPosition.voxelMag1Y, bucketPosition.voxelMag1Z),
            mag = mag,
            cubeSize = Vec3Int.full(DataLayer.bucketLength + 1),
            fullMeshRequest.segmentId,
            voxelSize.factor,
            fullMeshRequest.mappingName,
            fullMeshRequest.mappingType,
            fullMeshRequest.additionalCoordinates,
            findNeighbors = false
          )
          loadMeshChunkFromAdHoc(token, tracing, adHocMeshRequest, tracingId)
      }
      allVertices = vertexChunksWithNeighbors.map(_._1)
    } yield allVertices

  private def getAllAdHocChunksWithNeighborLogic(token: Option[String],
                                                 tracing: VolumeTracing,
                                                 tracingId: String,
                                                 mag: Vec3Int,
                                                 voxelSize: VoxelSize,
                                                 fullMeshRequest: FullMeshRequest,
                                                 topLeftOpt: Option[VoxelPosition],
                                                 chunkSize: Vec3Int,
                                                 visited: collection.mutable.Set[VoxelPosition] =
                                                   collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext): Fox[List[Array[Float]]] =
    for {
      topLeft <- topLeftOpt.toFox ?~> "seedPosition.neededForAdHoc"
      adHocMeshRequest = WebknossosAdHocMeshRequest(
        position = Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
        mag = mag,
        cubeSize = Vec3Int(chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
        fullMeshRequest.segmentId,
        voxelSize.factor,
        fullMeshRequest.mappingName,
        fullMeshRequest.mappingType,
        fullMeshRequest.additionalCoordinates
      )
      _ = visited += topLeft
      (vertices: Array[Float], neighbors) <- loadMeshChunkFromAdHoc(token, tracing, adHocMeshRequest, tracingId)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunksWithNeighborLogic(token,
                                           tracing,
                                           tracingId,
                                           mag,
                                           voxelSize,
                                           fullMeshRequest,
                                           Some(position),
                                           chunkSize,
                                           visited)
      }
      allVertices: List[Array[Float]] = vertices +: neighborVerticesNested.flatten
    } yield allVertices

  private def loadMeshChunkFromAdHoc(token: Option[String],
                                     tracing: VolumeTracing,
                                     adHocMeshRequest: WebknossosAdHocMeshRequest,
                                     tracingId: String): Fox[(Array[Float], List[Int])] =
    if (tracing.getHasEditableMapping)
      editableMappingService.createAdHocMesh(tracing, tracingId, adHocMeshRequest, token)
    else volumeTracingService.createAdHocMesh(tracingId, adHocMeshRequest, token)
}
