package models.dataset

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.PathValidationResult
import com.scalableminds.webknossos.datastore.explore.{
  ExploreRemoteDatasetRequest,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerParameters
}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, RawCuboidRequest}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{PathStorageUsageRequest, PathStorageUsageResponse}
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import play.api.libs.json.JsObject
import play.utils.UriEncoding

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class WKRemoteDataStoreClient(dataStore: DataStore, rpc: RPC) extends LazyLogging {

  private lazy val hasSegmentIndexFileCache: AlfuCache[(ObjectId, String), Boolean] =
    AlfuCache(timeToLive = 1 minute)

  def getDataLayerThumbnail(dataset: Dataset,
                            dataLayerName: String,
                            mag1BoundingBox: BoundingBox,
                            mag: Vec3Int,
                            mappingName: Option[String],
                            intensityRangeOpt: Option[(Double, Double)],
                            colorSettingsOpt: Option[ThumbnailColorSettings]): Fox[Array[Byte]] = {
    val targetMagBoundingBox = mag1BoundingBox / mag
    logger.debug(
      s"Thumbnail called for: ${dataset._id}, organization: ${dataset._organization}, directoryName: ${dataset.directoryName}, Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${dataset._id}/layers/$dataLayerName/thumbnail.jpg")
      .addQueryParam("token", RpcTokenHolder.webknossosToken)
      .addQueryParam("mag", mag.toMagLiteral())
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
    logger.debug(s"Fetching raw data. Mag $mag, mag1 bbox: $mag1BoundingBox, target-mag bbox: $targetMagBoundingBox")
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

  def updateDataSourceOnDisk(datasetId: ObjectId, dataSource: UsableDataSource): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .putJson(dataSource)
    } yield ()

  def deleteOnDisk(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId/deleteOnDisk")
        .addQueryParam("token", RpcTokenHolder.webknossosToken)
        .delete()
    } yield ()

  def deletePaths(paths: Seq[UPath]): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/deletePaths") // TODO datastore-side
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .deleteJson(paths)
    } yield ()

}
