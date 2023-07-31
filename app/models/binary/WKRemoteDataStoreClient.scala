package models.binary

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, GenericDataSource}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.DirectoryStorageReport
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import play.api.libs.json.JsObject
import play.utils.UriEncoding
import utils.ObjectId

class WKRemoteDataStoreClient(dataStore: DataStore, rpc: RPC) extends LazyLogging {

  def getDataLayerThumbnail(organizationName: String,
                            dataSet: DataSet,
                            dataLayerName: String,
                            mag1BoundingBox: BoundingBox,
                            mag: Vec3Int,
                            mappingName: Option[String],
                            intensityRangeOpt: Option[(Double, Double)]): Fox[Array[Byte]] = {
    val targetMagBoundingBox = mag1BoundingBox / mag
    logger.debug(s"Thumbnail called for: $organizationName/${dataSet.name}, Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.jpg")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("mag" -> mag.toMagLiteral())
      .addQueryString("x" -> mag1BoundingBox.topLeft.x.toString)
      .addQueryString("y" -> mag1BoundingBox.topLeft.y.toString)
      .addQueryString("z" -> mag1BoundingBox.topLeft.z.toString)
      .addQueryString("width" -> targetMagBoundingBox.width.toString)
      .addQueryString("height" -> targetMagBoundingBox.height.toString)
      .addQueryStringOptional("mappingName", mappingName)
      .addQueryStringOptional("intensityMin", intensityRangeOpt.map(_._1.toString))
      .addQueryStringOptional("intensityMax", intensityRangeOpt.map(_._2.toString))
      .getWithBytesResponse
  }

  def getLayerData(organizationName: String,
                   dataset: DataSet,
                   layerName: String,
                   mag1BoundingBox: BoundingBox,
                   mag: Vec3Int): Fox[Array[Byte]] = {
    val targetMagBoundingBox = mag1BoundingBox / mag
    logger.debug(s"Fetching raw data. Mag $mag, mag1 bbox: $mag1BoundingBox, target-mag bbox: $targetMagBoundingBox")
    rpc(
      s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataset.urlEncodedName}/layers/$layerName/data")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("mag" -> mag.toMagLiteral())
      .addQueryString("x" -> mag1BoundingBox.topLeft.x.toString)
      .addQueryString("y" -> mag1BoundingBox.topLeft.y.toString)
      .addQueryString("z" -> mag1BoundingBox.topLeft.z.toString)
      .addQueryString("width" -> targetMagBoundingBox.width.toString)
      .addQueryString("height" -> targetMagBoundingBox.height.toString)
      .addQueryString("depth" -> targetMagBoundingBox.depth.toString)
      .getWithBytesResponse
  }

  def findPositionWithData(organizationName: String, dataSet: DataSet, dataLayerName: String): Fox[JsObject] =
    rpc(
      s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/findData")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .getWithJsonResponse[JsObject]

  private def urlEncode(text: String) = UriEncoding.encodePathSegment(text, "UTF-8")

  def fetchStorageReport(organizationName: String, datasetName: Option[String]): Fox[List[DirectoryStorageReport]] =
    rpc(s"${dataStore.url}/data/datasets/measureUsedStorage/${urlEncode(organizationName)}")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryStringOptional("dataSetName", datasetName)
      .silent
      .getWithJsonResponse[List[DirectoryStorageReport]]

  def addDataSource(organizationName: String,
                    datasetName: String,
                    dataSource: GenericDataSource[DataLayer],
                    folderId: Option[ObjectId],
                    userToken: String): Fox[Unit] =
    for {
      _ <- rpc(s"${dataStore.url}/data/datasets/$organizationName/$datasetName")
        .addQueryString("token" -> userToken)
        .addQueryStringOptional("folderId", folderId.map(_.toString))
        .put(dataSource)
    } yield ()

}
