package models.binary

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import controllers.RpcTokenHolder
import org.apache.commons.codec.binary.Base64
import play.api.libs.json.JsObject
import play.utils.UriEncoding

class WKRemoteDataStoreClient(dataStore: DataStore, dataSet: DataSet, rpc: RPC) extends LazyLogging {

  def baseInfo = s"Dataset: ${dataSet.name} Datastore: ${dataStore.url}"

  def requestDataLayerThumbnail(organizationName: String,
                                dataLayerName: String,
                                width: Int,
                                height: Int,
                                zoom: Option[Double],
                                center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug(s"Thumbnail called for: $organizationName-${dataSet.name} Layer: $dataLayerName")
    rpc(s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .addQueryString("width" -> width.toString, "height" -> height.toString)
      .addQueryStringOptional("zoom", zoom.map(_.toString))
      .addQueryStringOptional("centerX", center.map(_.x.toString))
      .addQueryStringOptional("centerY", center.map(_.y.toString))
      .addQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail]
      .map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  def findPositionWithData(organizationName: String, dataLayerName: String): Fox[JsObject] =
    rpc(
      s"${dataStore.url}/data/datasets/${urlEncode(organizationName)}/${dataSet.urlEncodedName}/layers/$dataLayerName/findData")
      .addQueryString("token" -> RpcTokenHolder.webKnossosToken)
      .getWithJsonResponse[JsObject]

  private def urlEncode(text: String) = UriEncoding.encodePathSegment(text, "UTF-8")

}
