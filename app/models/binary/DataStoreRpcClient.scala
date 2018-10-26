package models.binary

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.codec.binary.Base64
import oxalis.security.CompactRandomIDGenerator
import play.api.libs.ws.WSResponse
import play.utils.UriEncoding

import scala.concurrent.ExecutionContext

object DataStoreRpcClient {
  lazy val webKnossosToken = CompactRandomIDGenerator.generateBlocking(16)
}

class DataStoreRpcClient(dataStore: DataStore, dataSet: DataSet, rpc: RPC)(implicit ec: ExecutionContext) extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Datastore: ${dataStore.url}"

  def requestDataLayerThumbnail(organizationName: String, dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug(s"Thumbnail called for: $organizationName-${dataSet.name} Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .addQueryString("token" -> DataStoreRpcClient.webKnossosToken)
      .addQueryString("width" -> width.toString, "height" -> height.toString)
      .addQueryStringOptional("zoom", zoom.map(_.toString))
      .addQueryStringOptional("centerX", center.map(_.x.toString))
      .addQueryStringOptional("centerY", center.map(_.y.toString))
      .addQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  private def urlEncode(text: String) = {UriEncoding.encodePathSegment(text, "UTF-8")}

}
