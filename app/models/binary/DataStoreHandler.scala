/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.braingames.binary.helpers.ThumbnailHelpers
import com.scalableminds.braingames.binary.models.datasource.{DataSourceLike => DataSource}
import com.scalableminds.braingames.datastore.models.ImageThumbnail
import com.scalableminds.braingames.datastore.tracings.TracingReference
import com.scalableminds.braingames.datastore.tracings.skeleton.{CreateEmptyParameters, TracingSelector}
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import play.api.http.Status
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsObject
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec

trait DataStoreHandlingStrategy {

  def createSkeletonTracing(dataStoreInfo: DataStoreInfo, base: DataSource, parameters: CreateEmptyParameters): Fox[TracingReference] =
    Fox.failure("DataStore doesn't support creation of SkeletonTracings.")

  def duplicateSkeletonTracing(dataStoreInfo: DataStoreInfo, base: DataSource, tracingReference: TracingReference): Fox[TracingReference] =
    Fox.failure("DatStore doesn't support duplication of SkeletonTracings.")

  def mergeSkeletonTracings(dataStoreInfo: DataStoreInfo, base: DataSource, tracingSelectors: List[TracingSelector], readOnly: Boolean): Fox[TracingReference] =
    Fox.failure("DataStore does't support merging of SkeletonTracings.")

  def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[TracingReference] =
    Fox.failure("DataStore doesn't support creation of VolumeTracings.")

  def uploadVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource, file: TemporaryFile): Fox[TracingReference] =
    Fox.failure("DataStore doesn't support creation of VolumeTracings.")

  def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] =
    Fox.failure("DataStore doesn't support thumbnail creation.")

  def importDataSource(dataSet: DataSet): Fox[WSResponse] =
    Fox.failure("DataStore doesn't support dataSource import.")
}

//TODO: RocksDB: make this a class, create object with FromDataSetName method (maybe the apply method), returning a new instance (maybe cache the instances)
object WKStoreHandlingStrategy extends DataStoreHandlingStrategy with LazyLogging {

  override def createSkeletonTracing(dataStoreInfo: DataStoreInfo, base: DataSource, parameters: CreateEmptyParameters): Fox[TracingReference] = {
    logger.debug("Called to create empty SkeletonTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeletons/createFromParams")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString("dataSetName" -> base.id.name)
      .postWithJsonResponse[CreateEmptyParameters, TracingReference](parameters)
  }

  override def duplicateSkeletonTracing(dataStoreInfo: DataStoreInfo, base: DataSource, tracingReference: TracingReference): Fox[TracingReference] = {
    logger.debug("Called to duplicate SkeletonTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeletons/${tracingReference.id}/duplicate")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .getWithJsonResponse[TracingReference]
  }

  override def mergeSkeletonTracings(dataStoreInfo: DataStoreInfo, base: DataSource, tracingSelectors: List[TracingSelector], readOnly: Boolean): Fox[TracingReference] = {
    logger.debug("Called to merge SkeletonTracings. Base: " + base.id + " Datastore: " + dataStoreInfo)
    val route = if (readOnly) "getMerged" else "createMergedFromIds"
    RPC(s"${dataStoreInfo.url}/dat/tracings/skeletons/${route}")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .postWithJsonResponse[List[TracingSelector], TracingReference](tracingSelectors)
  }

  override def createVolumeTracing(dataStoreInfo: DataStoreInfo, base: DataSource): Fox[TracingReference] = {
    logger.debug("Called to create VolumeTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/volumes")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString("dataSetName" -> base.id.name)
      .postWithJsonResponse[JsObject, TracingReference]()
  }

  override def uploadVolumeTracing(
                           dataStoreInfo: DataStoreInfo,
                           base: DataSource,
                           file: TemporaryFile): Fox[TracingReference] = {
    logger.debug("Called to upload VolumeTracing. Base: " + base.id + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/volumes")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString("dataSetName" -> base.id.name)
      .postWithJsonResponse[TracingReference](file.file)
  }

  override def requestDataLayerThumbnail(dataSet: DataSet, dataLayerName: String, width: Int, height: Int): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    RPC(s"${dataSet.dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  override def importDataSource(dataSet: DataSet): Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    RPC(s"${dataSet.dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .withQueryString("token" -> DataTokenService.webKnossosToken)
      .post()
  }
}

object NDStoreHandlingStrategy extends DataStoreHandlingStrategy with FoxImplicits with LazyLogging {

  override def requestDataLayerThumbnail(
    dataSet: DataSet,
    dataLayerName: String,
    width: Int,
    height: Int): Fox[Array[Byte]] = {

    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)

    def extractImage(response: WSResponse)(implicit codec: Codec): Fox[Array[Byte]] = {
      logger.error(response.toString)
      if (response.status == Status.OK) {
        Fox.successful(response.bodyAsBytes)
      } else {
        Fox.failure("ndstore.thumbnail.failed")
      }
    }

    for {
      dataLayer <- dataSet.dataSource.toUsable.flatMap(ds => ds.getDataLayer(dataLayerName)).toFox
      accessToken <- dataSet.dataStoreInfo.accessToken ?~> "ndstore.accesstoken.missing"
      thumbnail = ThumbnailHelpers.goodThumbnailParameters(dataLayer, width, height)
      resolution = (math.log(thumbnail.resolution) / math.log(2)).toInt
      imageParams = s"${resolution}/${thumbnail.x},${thumbnail.x + width}/${thumbnail.y},${thumbnail.y + height}/${thumbnail.z},${thumbnail.z + 1}"
      baseUrl = s"${dataSet.dataStoreInfo.url}/nd/ca"
      _ = logger.error(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams")
      response <- WS.url(s"$baseUrl/$accessToken/$dataLayerName/jpeg/$imageParams").get().toFox
      image <- extractImage(response)
    } yield image
  }
}
