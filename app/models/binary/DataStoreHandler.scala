package models.binary

import java.io.File
import java.math.BigInteger
import java.security.SecureRandom

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracings}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.ImageThumbnail
import com.scalableminds.webknossos.datastore.tracings.TracingSelector
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import org.apache.commons.codec.binary.Base64
import play.api.Play.current
import play.api.http.Status
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.Codec

trait DataStoreHandlingStrategy {

  def getSkeletonTracing(tracingId: String): Fox[SkeletonTracing] =
    Fox.failure("DataStore doesn't support getting SkeletonTracings")

  def getSkeletonTracings(tracingIds: List[String]): Fox[SkeletonTracings] =
    Fox.failure("DataStore doesn't support getting SkeletonTracings")

  def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] =
    Fox.failure("DataStore doesn't support saving SkeletonTracings.")

  def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[String]]] =
    Fox.failure("DataStore doesn't support saving SkeletonTracings.")

  def duplicateSkeletonTracing(skeletonTracingId: String, versionString: Option[String] = None): Fox[String] =
    Fox.failure("DatStore doesn't support duplication of SkeletonTracings.")

  def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] =
    Fox.failure("DataStore does't support merging of SkeletonTracings by ids.")

  def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] =
    Fox.failure("DataStore does't support merging of SkeletonTracings by contents.")

  def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File] = None): Fox[String] =
    Fox.failure("DataStore doesn't support creation of VolumeTracings.")

  def getVolumeTracing(tracingId: String): Fox[(VolumeTracing, Enumerator[Array[Byte]])] =
    Fox.failure("DataStore doesn't support getting VolumeTracings")

  def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] =
    Fox.failure("DataStore doesn't support thumbnail creation.")

  def importDataSource: Fox[WSResponse] =
    Fox.failure("DataStore doesn't support dataSource import.")
}

object DataStoreHandlingStrategy {

  lazy val webKnossosToken = new BigInteger(130, new SecureRandom()).toString(32)

}

class WKStoreHandlingStrategy(dataStoreInfo: DataStoreInfo, dataSet: DataSet) extends DataStoreHandlingStrategy with LazyLogging {

  override def getSkeletonTracing(tracingId: String): Fox[SkeletonTracing] = {
    logger.debug("Called to get SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/${tracingId}")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .getWithProtoResponse[SkeletonTracing](SkeletonTracing)
  }

  override def getSkeletonTracings(tracingIds: List[String]): Fox[SkeletonTracings] = {
    logger.debug("Called to get multiple SkeletonTracings. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/getMultiple")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .postJsonWithProtoResponse[List[TracingSelector], SkeletonTracings](tracingIds.map(TracingSelector(_)))(SkeletonTracings)
  }

  override def saveSkeletonTracing(tracing: SkeletonTracing): Fox[String] = {
    logger.debug("Called to save SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/save")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracing, String](tracing)
  }

  override def saveSkeletonTracings(tracings: SkeletonTracings): Fox[List[Box[String]]] = {
    logger.debug("Called to save SkeletonTracings. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/saveMultiple")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .postProtoWithJsonResponse[SkeletonTracings, List[Box[String]]](tracings)
  }

  override def duplicateSkeletonTracing(skeletonTracingId: String, versionString: Option[String] = None): Fox[String] = {
    logger.debug("Called to duplicate SkeletonTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/${skeletonTracingId}/duplicate")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .withQueryStringOptional("version", versionString)
      .getWithJsonResponse[String]
  }

  override def mergeSkeletonTracingsByIds(tracingIds: List[String], persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by ids. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/mergedFromIds")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postWithJsonResponse[List[TracingSelector], String](tracingIds.map(TracingSelector(_)))
  }

  override def mergeSkeletonTracingsByContents(tracings: SkeletonTracings, persistTracing: Boolean): Fox[String] = {
    logger.debug("Called to merge SkeletonTracings by contents. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    RPC(s"${dataStoreInfo.url}/data/tracings/skeleton/mergedFromContents")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .withQueryString("persist" -> persistTracing.toString)
      .postProtoWithJsonResponse[SkeletonTracings, String](tracings)
  }

  override def saveVolumeTracing(tracing: VolumeTracing, initialData: Option[File]): Fox[String] = {
    logger.debug("Called to create VolumeTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    for {
      tracingId <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/save")
        .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
        .postProtoWithJsonResponse[VolumeTracing, String](tracing)
      _ <- initialData match {
        case Some(file) =>
          RPC(s"${dataStoreInfo.url}/data/tracings/volume/${tracingId}/initialData")
            .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
            .post(file)
        case _ =>
          Fox.successful(())
      }
    } yield {
      tracingId
    }
  }

  override def getVolumeTracing(tracingId: String): Fox[(VolumeTracing, Enumerator[Array[Byte]])] = {
    logger.debug("Called to get VolumeTracing. Base: " + dataSet.name + " Datastore: " + dataStoreInfo)
    for {
      tracing <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/${tracingId}")
        .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
        .getWithProtoResponse[VolumeTracing](VolumeTracing)
      data <- RPC(s"${dataStoreInfo.url}/data/tracings/volume/${tracingId}/data")
        .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
        .getStream.map(_._2)
    } yield {
      (tracing, data)
    }
  }

  override def requestDataLayerThumbnail(dataLayerName: String, width: Int, height: Int, zoom: Option[Int], center: Option[Point3D]): Fox[Array[Byte]] = {
    logger.debug("Thumbnail called for: " + dataSet.name + " Layer: " + dataLayerName)
    RPC(s"${dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/layers/$dataLayerName/thumbnail.json")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .withQueryString( "width" -> width.toString, "height" -> height.toString)
      .withQueryStringOptional("zoom", zoom.map(_.toString))
      .withQueryStringOptional("centerX", center.map(_.x.toString))
      .withQueryStringOptional("centerY", center.map(_.y.toString))
      .withQueryStringOptional("centerZ", center.map(_.z.toString))
      .getWithJsonResponse[ImageThumbnail].map(thumbnail => Base64.decodeBase64(thumbnail.value))
  }

  override def importDataSource: Fox[WSResponse] = {
    logger.debug("Import called for: " + dataSet.name)
    RPC(s"${dataStoreInfo.url}/data/datasets/${dataSet.urlEncodedName}/import")
      .withQueryString("token" -> DataStoreHandlingStrategy.webKnossosToken)
      .post()
  }
}
