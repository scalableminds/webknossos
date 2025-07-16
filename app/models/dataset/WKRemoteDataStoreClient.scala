package models.dataset

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.explore.{ExploreRemoteDatasetRequest, ExploreRemoteDatasetResponse, ExploreRemoteLayerParameters}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, RawCuboidRequest}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.PathStorageReport
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import play.api.libs.json.JsObject
import play.utils.UriEncoding

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class WKRemoteDataStoreClient(dataStore: DataStore, rpc: RPC) extends LazyLogging {

  private lazy val hasSegmentIndexFileCache: AlfuCache[(String, String), Boolean] =
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
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .addQueryString("mag" -> mag.toMagLiteral())
      .addQueryString("x" -> mag1BoundingBox.topLeft.x.toString)
      .addQueryString("y" -> mag1BoundingBox.topLeft.y.toString)
      .addQueryString("z" -> mag1BoundingBox.topLeft.z.toString)
      .addQueryString("width" -> targetMagBoundingBox.width.toString)
      .addQueryString("height" -> targetMagBoundingBox.height.toString)
      .addQueryStringOptional("mappingName", mappingName)
      .addQueryStringOptional("intensityMin", intensityRangeOpt.map(_._1.toString))
      .addQueryStringOptional("intensityMax", intensityRangeOpt.map(_._2.toString))
      .addQueryStringOptional("color", colorSettingsOpt.map(_.color.toHtml))
      .addQueryStringOptional("invertColor", colorSettingsOpt.map(_.isInverted.toString))
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
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .postJsonWithBytesResponse(
        RawCuboidRequest(mag1BoundingBox.topLeft, targetMagBoundingBox.size, mag, additionalCoordinates))
  }

  def findPositionWithData(dataset: Dataset, dataLayerName: String): Fox[JsObject] =
    rpc(s"${dataStore.url}/data/datasets/${dataset._id}/layers/$dataLayerName/findData")
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .getWithJsonResponse[JsObject]

  private def urlEncode(text: String) = UriEncoding.encodePathSegment(text, "UTF-8")

  def fetchStorageReport(organizationId: String, paths: List[String]): Fox[List[PathStorageReport]] =
    rpc(s"${dataStore.url}/data/datasets/measureUsedStorage/${urlEncode(organizationId)}")
      .addQueryString("token" -> RpcTokenHolder.webknossosToken)
      .silent
      .postJsonWithJsonResponse[List[String], List[PathStorageReport]](paths)

  def hasSegmentIndexFile(datasetId: String, layerName: String)(implicit ec: ExecutionContext): Fox[Boolean] = {
    val cacheKey = (datasetId, layerName)
    hasSegmentIndexFileCache.getOrLoad(
      cacheKey,
      k =>
        rpc(s"${dataStore.url}/data/datasets/${k._1}/layers/${k._2}/hasSegmentIndex")
          .addQueryString("token" -> RpcTokenHolder.webknossosToken)
          .silent
          .getWithJsonResponse[Boolean]
    )
  }

  def exploreRemoteDataset(layerParameters: List[ExploreRemoteLayerParameters],
                           organizationId: String,
                           userToken: String): Fox[ExploreRemoteDatasetResponse] =
    rpc(s"${dataStore.url}/data/datasets/exploreRemote")
      .addQueryString("token" -> userToken)
      .postJsonWithJsonResponse[ExploreRemoteDatasetRequest, ExploreRemoteDatasetResponse](
        ExploreRemoteDatasetRequest(layerParameters, organizationId))

  def updateDatasetInDSCache(datasetId: String): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$datasetId")
        .addQueryString("token" -> RpcTokenHolder.webknossosToken)
        .delete()
    } yield ()

}
