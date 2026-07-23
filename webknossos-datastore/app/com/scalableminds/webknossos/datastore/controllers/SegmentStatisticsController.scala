package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
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
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, UsableDataSource}
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
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.tools.Fox.toFox
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
          segmentStatisticsFileInfosBox <- segmentStatisticsFileService.getInfos(dataSource.id, dataLayer).shiftBox
          segmentStatisticsFileInfosSeq <- segmentStatisticsFileInfosBox match {
            case Full(segmentStatisticsFileInfos) => Fox.successful(Seq(segmentStatisticsFileInfos))
            case Empty                            => Fox.successful(Seq.empty)
            case f: Failure                       => f.toFox
          }
        } yield Ok(Json.toJson(segmentStatisticsFileInfosSeq))
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

  /** Segment volumes: prefer the segment statistics file (if present and compatible with the request); otherwise fall
    * back to computing them from the segment index file.
    */
  def getSegmentVolume(datasetId: ObjectId, dataLayerName: String): Action[SegmentStatisticsParameters] =
    Action.fox(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          volumesFromStatisticsFileBox <- volumesFromSegmentStatisticsFile(
            dataSource.id,
            dataLayer,
            request.body
          ).shiftBox
          volumes <- volumesFromStatisticsFileBox match {
            case Full(volumes) => Fox.successful(volumes)
            case _             => volumesFromSegmentIndexFile(datasetId, dataSource.id, dataLayer, request.body)
          }
        } yield Ok(Json.toJson(volumes))
      }
    }

  private def volumesFromSegmentStatisticsFile(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      params: SegmentStatisticsParameters
  )(using tc: TokenContext): Fox[Seq[Long]] =
    for {
      segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(dataSourceId, dataLayer)
      _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
        segmentStatisticsFileKey,
        dataLayer,
        params.mag,
        params.mappingName,
        allowRemapping = true
      )
      remappingNeeded <- segmentStatisticsFileService.needsRemapping(segmentStatisticsFileKey, params.mappingName)
      volumes <-
        if (remappingNeeded) {
          // Serial on purpose: getCombinedVolumeInMag already parallelizes reads across each agglomerate's
          // oversegmentation ids, so parallelizing here too would multiply fan-out.
          Fox.serialCombined(params.segmentIds) { segmentOrAgglomerateId =>
            for {
              oversegmentationIds <- segmentIdsForAgglomerateIdIfNeeded(
                dataSourceId,
                dataLayer,
                params.mappingName,
                None,
                params.annotationVersion,
                segmentOrAgglomerateId,
                mappingNameForMeshFile = None,
                omitMissing = false
              )
              volume <- segmentStatisticsFileService.getCombinedVolumeInRequestedMag(
                segmentStatisticsFileKey,
                dataLayer,
                oversegmentationIds,
                params.mag
              )
            } yield volume
          }
        } else {
          // Shortcut: the file already holds stats for the requested mapping (or lack thereof), no need to combine
          // oversegmentation values.
          segmentStatisticsFileService.getVolumesInRequestedMag(
            segmentStatisticsFileKey,
            dataLayer,
            params.segmentIds,
            params.mag
          )
        }
    } yield volumes

  private def volumesFromSegmentIndexFile(
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      params: SegmentStatisticsParameters
  )(using tc: TokenContext): Fox[Seq[Long]] =
    for {
      segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSourceId, dataLayer)
      agglomerateFileKeyOpt <- Fox.runOptional(params.mappingName)(
        agglomerateService.lookUpAgglomerateFileKey(dataSourceId, dataLayer, _)
      )
      volumes <- Fox.serialCombined(params.segmentIds) { segmentId =>
        segmentIndexFileService.getSegmentVolumeViaSegmentIndex(
          datasetId,
          dataSourceId,
          dataLayer,
          segmentIndexFileKey,
          agglomerateFileKeyOpt,
          segmentId,
          params.mag
        )
      }
    } yield volumes

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
          surfaceAreasFromStatisticsFileBox <- surfaceAreasFromSegmentStatisticsFile(
            dataSource.id,
            dataLayer,
            request.body
          ).shiftBox
          surfaceAreas <- surfaceAreasFromStatisticsFileBox match {
            case Full(surfaceAreas) => Fox.successful(surfaceAreas)
            case _                  => surfaceAreasFromFullMeshService(datasetId, dataSource, dataLayer, request.body)
          }
        } yield Ok(Json.toJson(surfaceAreas))
      }
    }

  private def surfaceAreasFromSegmentStatisticsFile(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      params: SegmentStatisticsParametersMeshBased
  )(using tc: TokenContext): Fox[Seq[Float]] =
    for {
      segmentStatisticsFileKey <- segmentStatisticsFileService.lookUpSegmentStatisticsFileKey(dataSourceId, dataLayer)
      _ <- segmentStatisticsFileService.checkMagAndMappingNameMatch(
        segmentStatisticsFileKey,
        dataLayer,
        params.mag,
        params.mappingName,
        allowRemapping = false
      )
      surfaceAreas <- segmentStatisticsFileService.getSurfaceAreas(segmentStatisticsFileKey, params.segmentIds)
    } yield surfaceAreas

  private def surfaceAreasFromFullMeshService(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      params: SegmentStatisticsParametersMeshBased
  )(using tc: TokenContext): Fox[Seq[Float]] =
    for {
      meshFileKeyOpt <- Fox.runOptional(params.meshFileName)(
        meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, _)
      )
      mappingNameForMeshFile <- Fox.runOptional(meshFileKeyOpt)(meshFileService.mappingNameForMeshFile)
      surfaceAreas <- Fox.serialCombined(params.segmentIds) { segmentId =>
        val fullMeshRequest = FullMeshRequest(
          meshFileName = if (mappingNameForMeshFile.contains(params.meshFileName)) params.meshFileName else None,
          lod = None,
          segmentId = segmentId,
          mappingName = params.mappingName,
          mappingType = params.mappingName.map(_ => "HDF5"),
          editableMappingTracingId = None,
          annotationVersion = None,
          mag = Some(params.mag),
          seedPosition = None,
          additionalCoordinates = params.additionalCoordinates
        )
        fullMeshService.segmentSurfaceAreaCache.getOrLoad(
          (datasetId, dataLayer.name, fullMeshRequest),
          _ =>
            fullMeshService
              .computeSurfaceArea(datasetId, dataSource, dataLayer, fullMeshRequest) ?~> Msg.Mesh.loadFullFailed
        )
      }
    } yield surfaceAreas

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
            request.body.mappingName,
            allowRemapping = true
          )
          remappingNeeded <- segmentStatisticsFileService.needsRemapping(
            segmentStatisticsFileKey,
            request.body.mappingName
          )
          covarianceMatrices <-
            if (remappingNeeded) {
              Fox.serialCombined(request.body.segmentIds) { segmentOrAgglomerateId =>
                for {
                  oversegmentationIds <- segmentIdsForAgglomerateIdIfNeeded(
                    dataSource.id,
                    dataLayer,
                    request.body.mappingName,
                    None,
                    request.body.annotationVersion,
                    segmentOrAgglomerateId,
                    mappingNameForMeshFile = None,
                    omitMissing = false
                  )
                  covarianceMatrix <- segmentStatisticsFileService.getCombinedCovarianceMatrix(
                    segmentStatisticsFileKey,
                    dataLayer,
                    oversegmentationIds
                  )
                } yield covarianceMatrix
              }
            } else {
              // Shortcut: the file already holds stats for the requested mapping (or lack thereof), no need to
              // combine oversegmentation values.
              segmentStatisticsFileService.getCovarianceMatrices(segmentStatisticsFileKey, request.body.segmentIds)
            }
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
            request.body.mappingName,
            allowRemapping = false
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
            request.body.mappingName,
            allowRemapping = true
          )
          remappingNeeded <- segmentStatisticsFileService.needsRemapping(
            segmentStatisticsFileKey,
            request.body.mappingName
          )
          centerOfMasses <-
            if (remappingNeeded) {
              Fox.serialCombined(request.body.segmentIds) { segmentOrAgglomerateId =>
                for {
                  oversegmentationIds <- segmentIdsForAgglomerateIdIfNeeded(
                    dataSource.id,
                    dataLayer,
                    request.body.mappingName,
                    None,
                    request.body.annotationVersion,
                    segmentOrAgglomerateId,
                    mappingNameForMeshFile = None,
                    omitMissing = false
                  )
                  centerOfMass <- segmentStatisticsFileService.getCombinedCenterOfMass(
                    segmentStatisticsFileKey,
                    dataLayer,
                    oversegmentationIds
                  )
                } yield centerOfMass
              }
            } else {
              // Shortcut: the file already holds stats for the requested mapping (or lack thereof), no need to
              // combine oversegmentation values.
              segmentStatisticsFileService.getCenterOfMasses(segmentStatisticsFileKey, request.body.segmentIds)
            }
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
            request.body.mappingName,
            allowRemapping = false
          )
          sphericities <- segmentStatisticsFileService.getSphericities(
            segmentStatisticsFileKey,
            request.body.segmentIds
          )
        } yield Ok(Json.toJson(sphericities))
      }
    }
}
