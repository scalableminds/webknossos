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
import net.liftweb.common.Box

trait AnnotationContent {
  type Self <: AnnotationContent

  def service: AnnotationContentService

  def id: String

  def editPosition: Point3D

  def boundingBox: Option[BoundingBox]

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[Self]

  def settings: AnnotationSettings

  def copyDeepAndInsert: Fox[Self]

  def mergeWith(source: AnnotationContent): Fox[Self]

  def contentType: String

  def toDownloadStream: Fox[InputStream]

  def downloadFileExtension: String

  def contentData: Fox[JsObject] = Fox.empty

  lazy val date = new Date(timestamp)

  def dataSet(implicit ctx: DBAccessContext): Fox[DataSet] = DataSetDAO.findOneBySourceName(dataSetName)
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
      dataSet <- ac.dataSet.futureBox
      contentData <- ac.contentData getOrElse Json.obj()
    } yield {
      Json.obj(
        "settings" -> ac.settings,
        "dataSet" -> dataSet.toOption,
        "contentData" -> contentData,
        "editPosition" -> ac.editPosition,
        "boundingBox" -> ac.boundingBox,
        "contentType" -> ac.contentType)
    }
  }
}