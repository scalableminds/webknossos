package models.annotation

import java.util.Date
import braingames.geometry.{BoundingBox, Scale, Point3D}
import java.io.InputStream
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.binary.models.DataLayer
import models.binary.{DataSet, DataSetDAO}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import play.api.Logger

trait AnnotationContent {
  type Self <: AnnotationContent

  def service: AnnotationContentService

  def id: String

  def editPosition: Point3D

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[Self]

  def settings: AnnotationSettings

  def copyDeepAndInsert: Future[Self]

  def mergeWith(source: AnnotationContent): Future[Self]

  def contentType: String

  def toDownloadStream: Future[InputStream]

  def downloadFileExtension: String

  def contentData: Future[Option[JsObject]] = Future.successful(None)

  lazy val date = new Date(timestamp)

  def dataSet(implicit ctx: DBAccessContext): Future[Option[DataSet]] = DataSetDAO.findOneBySourceName(dataSetName)
}

object AnnotationContent {

  import AnnotationSettings._

  implicit val dataLayerWrites: Writes[DataLayer] =
    ((__ \ 'typ).write[String] and
      (__ \ 'maxCoordinates).write[BoundingBox] and
      (__ \ 'resolutions).write[List[Int]] and
      (__ \ 'elementClass).write[String])(l =>
      (l.typ, l.maxCoordinates, l.resolutions, l.elementClass))

  implicit val dataSetWrites: Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'scale).write[Scale] and
      (__ \ 'dataLayers).write[List[DataLayer]])(d =>
      (d.dataSource.name, d.dataSource.scale, d.dataSource.dataLayers))

  def writeAsJson(ac: AnnotationContent)(implicit ctx: DBAccessContext) = {
    for {
      dataSet <- ac.dataSet
      contentData <- ac.contentData
    } yield {
      ((__ \ 'settings).write[AnnotationSettings] and
        (__ \ 'dataSet).write[Option[DataSet]] and
        (__ \ 'contentData).write[Option[JsObject]] and
        (__ \ 'editPosition).write[Point3D] and
        (__ \ 'contentType).write[String])
      .tupled
      .writes((ac.settings, dataSet, contentData, ac.editPosition, ac.contentType))
    }
  }
}