package models.tracing.volume

import braingames.geometry.Point3D
import models.annotation.{AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import braingames.binary.models.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import oxalis.binary.BinaryDataService
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  timestamp: Long,
  editPosition: Point3D,
  settings: AnnotationSettings = AnnotationSettings.default,
  _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent {

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext) = ???

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def contentType: String =  VolumeTracing.contentType

  def toDownloadStream: Future[InputStream] = ???

  def downloadFileExtension: String = ???
}

object VolumeTracingService extends AnnotationContentService{
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Unit = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext): Future[Option[VolumeTracingService.AType]] = ???

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Future[VolumeTracingService.AType] = ???

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???
}

object VolumeTracing{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat

  def createFrom(baseDataSet: DataSet)(implicit ctx: DBAccessContext) = {
    val dataSet = BinaryDataService.createUserDataSet(baseDataSet)
    val t = VolumeTracing(dataSet.name, System.currentTimeMillis(), Point3D(0,0,0))
    insert(t)
  }

}
