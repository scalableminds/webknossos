package models.tracing.volume

import braingames.geometry.Point3D
import models.annotation.{AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary.UserDataLayerDAO
import braingames.binary.models.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import oxalis.binary.BinaryDataService
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  userDataLayerName: String,
  timestamp: Long,
  editPosition: Point3D,
  settings: AnnotationSettings = AnnotationSettings.volumeDefault,
  _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent {

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext) = {Fox.successful(this)}

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def contentType: String = VolumeTracing.contentType

  def toDownloadStream: Future[InputStream] = ???

  def downloadFileExtension: String = ???
}

object VolumeTracingService extends AnnotationContentService{
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Unit = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext): Future[Option[VolumeTracingService.AType]] =
    VolumeTracingDAO.findOneById(id)

  def createFrom(baseDataSet: DataSet)(implicit ctx: DBAccessContext) = {
    val userDataLayer = BinaryDataService.createUserDataLayer(baseDataSet)
    val volumeTracing = VolumeTracing(baseDataSet.name, userDataLayer.name, System.currentTimeMillis(), Point3D(0,0,0))
    UserDataLayerDAO.insert(userDataLayer)
    VolumeTracingDAO.insert(volumeTracing).map{ _ =>
      volumeTracing
    }
  }

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???
}

object VolumeTracing{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
