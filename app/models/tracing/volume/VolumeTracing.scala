package models.tracing.volume

import braingames.geometry.Point3D
import models.annotation.{AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import oxalis.binary.BinaryDataService
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
  import play.api.libs.concurrent.Execution.Implicits._
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

  def toDownloadStream: Fox[InputStream] = ???

  def downloadFileExtension: String = ???
}

object VolumeTracingService extends AnnotationContentService{
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???

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
    baseDataSet.dataSource.toFox.flatMap{ baseSource =>
      BinaryDataService.createUserDataSource(baseSource)
      insert(VolumeTracing(baseDataSet.name, System.currentTimeMillis(), Point3D(0,0,0)))
    }
  }

}
