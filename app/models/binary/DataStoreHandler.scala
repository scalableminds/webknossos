package models.binary

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.codec.binary.Base64
import oxalis.security.CompactRandomIDGenerator
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext

object DataStoreHandler {
  lazy val webKnossosToken = CompactRandomIDGenerator.generateBlocking(16)
}

class DataStoreHandler(dataStore: DataStore, dataSet: DataSet, rpc: RPC)(implicit ec: ExecutionContext) extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Datastore: ${dataStore.url}"

  def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    rpc(s"${dataStore.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .addQueryString( "width" -> width.toString, "height" -> height.toString)
      .addQueryStringOptional("zoom", zoom.map(_.toString))
      .addQueryStringOptional("centerX", center.map(_.x.toString))
      .addQueryStringOptional("centerY", center.map(_.y.toString))
      .addQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  def importDataSource: Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    rpc(s"${dataStore.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .addQueryString("token" -> DataStoreHandler.webKnossosToken)
      .post()
  }
}
