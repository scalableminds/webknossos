package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.{
  GetMultipleSegmentIndexParameters,
  GetSegmentIndexParameters,
  SegmentIndexData,
  SegmentStatisticsParameters,
  SegmentStatisticsParametersMeshBased
}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.services.*
import com.scalableminds.webknossos.datastore.services.mapping.AgglomerateService
import com.scalableminds.webknossos.datastore.services.mesh.{
  DSFullMeshService,
  FullMeshRequest,
  MeshFileService,
  MeshMappingHelper
}
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService
import com.scalableminds.webknossos.datastore.services.segmentstatistics.SegmentStatisticsFileService
import com.scalableminds.util.Msg
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class SegmentStatisticsController @Inject() (
    datasetCache: DatasetCache,
    accessTokenService: DataStoreAccessTokenService,
    segmentIndexFileService: SegmentIndexFileService,
    segmentStatisticsFileService: SegmentStatisticsFileService,
    agglomerateService: AgglomerateService,
    meshFileService: MeshFileService,
    fullMeshService: DSFullMeshService,
    val binaryDataServiceHolder: BinaryDataServiceHolder,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with MeshMappingHelper {

  override def allowRemoteOrigin: Boolean = true

  def checkSegmentIndexFile(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKeyBox <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer).shiftBox
        } yield Ok(Json.toJson(segmentIndexFileKeyBox.isDefined))
      }
    }

  def segmentStatisticsFileInfo(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentStatisticsFileInfosBox <- segmentStatisticsFileService.getInfos(dataSource.id, dataLayer)
          // TODO shift box, drop empty (fail on failure, though?)
        } yield Ok(Json.toJson(Seq(segmentStatisticsFileInfosBox)))
      }
    }

  /** Query the segment index file for a single segment
    *
    * @return
    *   List of bucketPositions as positions (not indices) of 32³ buckets in mag
    */
  def getSegmentIndex(
      datasetId: ObjectId,
      dataLayerName: String,
      segmentId: String
  ): Action[GetSegmentIndexParameters] =
    Action.fox(validateJson[GetSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
            dataSource.id,
            dataLayer,
            request.body.mappingName,
            None,
            request.body.annotationVersion,
            segmentId.toLong,
            mappingNameForMeshFile = None,
            omitMissing = false
          )
          topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
            segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId)
          )
          topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
          bucketPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(
            topLefts,
            request.body.mag
          )
          bucketPositionsForCubeSize = bucketPositions
            .map(_.scale(DataLayer.bucketLength)) // bucket positions raw are indices of 32³ buckets
            .map(_ / request.body.cubeSize)
            .distinct // divide by requested cube size to map them to larger buckets, select unique
            .map(_ * request.body.cubeSize) // return positions, not indices
        } yield Ok(Json.toJson(bucketPositionsForCubeSize))
      }
    }

  /** Query the segment index file for multiple segments
    *
    * @return
    *   List of bucketPositions as indices of 32³ buckets (in target mag)
    */
  def querySegmentIndex(datasetId: ObjectId, dataLayerName: String): Action[GetMultipleSegmentIndexParameters] =
    Action.fox(validateJson[GetMultipleSegmentIndexParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          segmentIdsAndBucketPositions <- Fox.serialCombined(request.body.segmentIds) { segmentOrAgglomerateId =>
            for {
              segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
                dataSource.id,
                dataLayer,
                request.body.mappingName,
                request.body.editableMappingTracingId,
                request.body.annotationVersion,
                segmentOrAgglomerateId,
                mappingNameForMeshFile = None,
                omitMissing = true // assume agglomerate ids not present in the mapping belong to user-brushed segments
              )
              topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
                segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId)
              )
              topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
              bucketPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(
                topLefts,
                request.body.mag
              )
            } yield SegmentIndexData(segmentOrAgglomerateId, bucketPositions.toSeq)
          }
        } yield Ok(Json.toJson(segmentIdsAndBucketPositions))
      }
    }

  def getSegmentVolume(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          agglomerateFileKeyOpt <- Fox.runOptional(request.body.mappingName)(
            agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, _)
          )
          volumes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentVolume(
              datasetId,
              dataSource.id,
              dataLayer,
              segmentIndexFileKey,
              agglomerateFileKeyOpt,
              segmentId,
              request.body.mag
            )
          }
        } yield Ok(Json.toJson(volumes))
      }
    }

  def getSegmentBoundingBox(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, dataLayer)
          agglomerateFileKeyOpt <- Fox.runOptional(request.body.mappingName)(
            agglomerateService.lookUpAgglomerateFileKey(dataSource.id, dataLayer, _)
          )
          boxes <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            segmentIndexFileService.getSegmentBoundingBox(
              datasetId,
              dataSource.id,
              dataLayer,
              segmentIndexFileKey,
              agglomerateFileKeyOpt,
              segmentId,
              request.body.mag
            )
          }
        } yield Ok(Json.toJson(boxes))
      }
    }

  def getSegmentSurfaceArea(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParametersMeshBased] =
    Action.fox(validateJson[SegmentStatisticsParametersMeshBased]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          meshFileKeyOpt <- Fox.runOptional(request.body.meshFileName)(
            meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, _)
          )
          mappingNameForMeshFile <- Fox.runOptional(meshFileKeyOpt)(meshFileService.mappingNameForMeshFile)
          surfaceAreas <- Fox.serialCombined(request.body.segmentIds) { segmentId =>
            val fullMeshRequest = FullMeshRequest(
              meshFileName =
                if (mappingNameForMeshFile.contains(request.body.meshFileName)) request.body.meshFileName else None,
              lod = None,
              segmentId = segmentId,
              mappingName = request.body.mappingName,
              mappingType = request.body.mappingName.map(_ => "HDF5"),
              editableMappingTracingId = None,
              annotationVersion = None,
              mag = Some(request.body.mag),
              seedPosition = None,
              additionalCoordinates = request.body.additionalCoordinates
            )
            fullMeshService.segmentSurfaceAreaCache.getOrLoad(
              (datasetId, dataLayer.name, fullMeshRequest),
              _ =>
                fullMeshService
                  .computeSurfaceArea(datasetId, dataSource, dataLayer, fullMeshRequest) ?~> Msg.Mesh.loadFullFailed
            )
          }
        } yield Ok(Json.toJson(surfaceAreas))
      }
    }

  def getSegmentCovarianceMatrix(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(
            dataSource.id,
            dataLayer
          )
          _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
            segmentStatisticsFileKey,
            dataLayer,
            request.body.mag,
            request.body.mappingName
          )
          covarianceMatrices <- segmentStatisticsFileService.getCovarianceMatrices(
            segmentStatisticsFileKey,
            request.body.segmentIds
          )
        } yield Ok(Json.toJson(covarianceMatrices))
      }
    }

  def getSegmentMaxDistance(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(
            dataSource.id,
            dataLayer
          )
          _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
            segmentStatisticsFileKey,
            dataLayer,
            request.body.mag,
            request.body.mappingName
          )
          maxDistances <- segmentStatisticsFileService.getMaxDistances(
            segmentStatisticsFileKey,
            request.body.segmentIds
          )
        } yield Ok(Json.toJson(maxDistances))
      }
    }

  def getSegmentCenterOfMass(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(
            dataSource.id,
            dataLayer
          )
          _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
            segmentStatisticsFileKey,
            dataLayer,
            request.body.mag,
            request.body.mappingName
          )
          centerOfMasses <- segmentStatisticsFileService.getCenterOfMasses(
            segmentStatisticsFileKey,
            request.body.segmentIds
          )
        } yield Ok(Json.toJson(centerOfMasses))
      }
    }

  def getSegmentSphericity(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(
            dataSource.id,
            dataLayer
          )
          _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
            segmentStatisticsFileKey,
            dataLayer,
            request.body.mag,
            request.body.mappingName
          )
          sphericities <- segmentStatisticsFileService.getSphericities(
            segmentStatisticsFileKey,
            request.body.segmentIds
          )
        } yield Ok(Json.toJson(sphericities))
      }
    }
}
