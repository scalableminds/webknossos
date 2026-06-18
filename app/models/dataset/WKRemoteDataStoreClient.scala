package models.dataset

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.{GetEffectiveVoxelSizeParameters, PathValidationResult}
import com.scalableminds.webknossos.datastore.explore.{ExploreRemoteDatasetRequest, ExploreRemoteDatasetResponse, ExploreRemoteLayerParameters}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, RawCuboidRequest, VoxelSize}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{DataSourceWithRootPathInfo, PathStorageUsageRequest, PathStorageUsageResponse}
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import play.api.libs.json.JsObject
import play.utils.UriEncoding

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class WKRemoteDataStoreClient(dataStore: DataStore, rpc: RPC) extends LazyLogging {

  private lazy val hasSegmentIndexFileCache: AlfuCache[(ObjectId, String), Boolean] =
    AlfuCache(timeToLive = 1 minute)

  private lazy val effectiveAiModelVoxelSizeCache: AlfuCache[UPath, VoxelSize] = AlfuCache(timeToLive = 15 minutes)

  def getDataLayerThumbnail(dataset: Dataset,
                            dataLayerName: String,
                            mag1BoundingBox: BoundingBox,
                            mag: Vec3Int,
                            mappingName: Option[String],
                            intensityRangeOpt: Option[(Double, Double)],
                            colorSettingsOpt: Option[ThumbnailColorSettings]): Fox[Array[Byte]] = {
    val targetMagBoundingBox = mag1BoundingBox / mag
    logger.info(
      s"Thumbnail called for: ${dataset._id}, organization: ${dataset._organization}, directoryName: ${dataset.directoryName}, Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${dataset._id}/layers/$dataLayerName/thumbnail.jpg")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .addQueryParam("mag", mag.toMagLiteral(allowScalar = false))
      .addQueryParam("x", mag1BoundingBox.topLeft.x)
      .addQueryParam("y", mag1BoundingBox.topLeft.y)
      .addQueryParam("z", mag1BoundingBox.topLeft.z)
      .addQueryParam("width", targetMagBoundingBox.width)
      .addQueryParam("height", targetMagBoundingBox.height)
      .addQueryParam("mappingName", mappingName)
      .addQueryParam("intensityMin", intensityRangeOpt.map(_._1))
      .addQueryParam("intensityMax", intensityRangeOpt.map(_._2))
      .addQueryParam("color", colorSettingsOpt.map(_.color.toHtml))
      .addQueryParam("invertColor", colorSettingsOpt.map(_.isInverted))
      .getWithBytesResponse
  }

  def getLayerData(dataset: Dataset,
                   layerName: String,
                   mag1BoundingBox: BoundingBox,
                   mag: Vec3Int,
                   additionalCoordinates: Option[Seq[AdditionalCoordinate]]): Fox[Array[Byte]] = {
    val targetMagBoundingBox = mag1BoundingBox / mag
    rpc(s"${dataStore.url}/data/datasets/${dataset._id}/layers/$layerName/readData")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .postJsonWithBytesResponse(
        RawCuboidRequest(mag1BoundingBox.topLeft, targetMagBoundingBox.size, mag, additionalCoordinates))
  }

  def findPositionWithData(dataset: Dataset, dataLayerName: String): Fox[JsObject] =
    rpc(s"${dataStore.url}/data/datasets/${dataset._id}/layers/$dataLayerName/findData")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .getWithJsonResponse[JsObject]

  private def urlEncode(text: String) = UriEncoding.encodePathSegment(text, "UTF-8")

  def fetchStorageReports(organizationId: String, paths: List[String]): Fox[PathStorageUsageResponse] =
    rpc(s"${dataStore.url}/data/datasets/measureUsedStorage/${urlEncode(organizationId)}")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .silent
      .postJsonWithJsonResponse[PathStorageUsageRequest, PathStorageUsageResponse](PathStorageUsageRequest(paths))

  def hasSegmentIndexFile(datasetId: ObjectId, layerName: String)(implicit ec: ExecutionContext): Fox[Boolean] = {
    val cacheKey = (datasetId, layerName)
    hasSegmentIndexFileCache.getOrLoad(
      cacheKey,
      k =>
        rpc(s"${dataStore.url}/data/datasets/${k._1}/layers/${k._2}/hasSegmentIndex")
          .addQueryParam("token", RpcTokenHolder.webknossosToken)
          .silent
          .getWithJsonResponse[Boolean]
    )
  }

  def exploreRemoteDataset(layerParameters: List[ExploreRemoteLayerParameters],
                           organizationId: String,
                           userToken: String): Fox[ExploreRemoteDatasetResponse] =
    rpc(s"${dataStore.url}/data/datasets/exploreRemote")
      .addQueryParam("token", userToken)
      .postJsonWithJsonResponse[ExploreRemoteDatasetRequest, ExploreRemoteDatasetResponse](
        ExploreRemoteDatasetRequest(layerParameters, organizationId))

  def validatePaths(paths: Seq[UPath]): Fox[List[PathValidationResult]] =
    rpc(s"${dataStore.url}/data/datasets/validatePaths")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .postJsonWithJsonResponse[Seq[UPath], List[PathValidationResult]](paths)

  def invalidateDatasetInDSCache(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .delete()
    } yield ()

  def updateDataSourceOnDisk(datasetId: ObjectId, dataSource: UsableDataSource, rootPath: String): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .addQueryParam("rootPath", rootPath)
        .putJson(dataSource)
    } yield ()

  def deleteOnDisk(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId/deleteOnDisk")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .delete()
    } yield ()

  def getOneBaseDirForOrgaAbsolute(organizationId: String): Fox[UPath] =
    rpc(s"${dataStore.url}/data/datasets/getOneBaseDirForOrgaAbsolute")
      .addQueryParam("organizationId", organizationId)
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .getWithJsonResponse[UPath]

  // Datastore deletes local paths and returns list of paths to be deleted externally.
  // Should not be called directly, go via PathDeletionService
  def deletePaths(paths: Seq[UPath]): Fox[Seq[UPath]] =
    for {
      pathsToDeleteExternally <- rpc(s"${dataStore.url}/data/datasets/deletePaths")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .deleteJsonWithJsonResponse[Seq[UPath], Seq[UPath]](paths)
    } yield pathsToDeleteExternally

  def getEffectiveAiModelVoxelSize(modelPath: UPath)(implicit ec: ExecutionContext): Fox[VoxelSize] =
    effectiveAiModelVoxelSizeCache.getOrLoad(
      modelPath,
      _ =>
        rpc(s"${dataStore.url}/data/aiModels/effectiveVoxelSize")
          .addQueryParam("token", RpcTokenHolder.webknossosToken)
          .postJsonWithJsonResponse[GetEffectiveVoxelSizeParameters, VoxelSize](
            GetEffectiveVoxelSizeParameters(modelPath))
    )

  def writeMirror(datasetIds: Seq[ObjectId], failOnError: Boolean): Fox[Seq[(ObjectId, String)]] =
    rpc(s"${dataStore.url}/data/datasets/writeMirrors")
      .addQueryParam("failOnError", failOnError)
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .postJsonWithJsonResponse[Seq[ObjectId], Seq[(ObjectId, String)]](datasetIds)

  def scanRealPathsForVirtual(dataSourcesWithrootPathInfo: Seq[DataSourceWithRootPathInfo])(implicit ec: ExecutionContext): Fox[Unit] = {
    val dataSourcesThatCanHaveRealpaths = dataSourcesWithrootPathInfo.filter(_.dataSource.toUsable.exists(_.allExplicitPaths.exists(_.isLocal)))
    if (dataSourcesThatCanHaveRealpaths.nonEmpty) {
      for {
        _ <- rpc(s"${dataStore.url}/data/triggers/scanRealPathsForVirtual")
          .addQueryParam("token", RpcTokenHolder.webknossosToken)
          .postJson[Seq[DataSourceWithRootPathInfo]](dataSourcesThatCanHaveRealpaths)
      } yield ()
    } else Fox.successful(())
  }

}
