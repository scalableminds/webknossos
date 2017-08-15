package models.annotation

import java.util.Date
import javax.xml.stream.XMLStreamWriter

import com.scalableminds.braingames.binary.models.datasource.{Category, ElementClass, DataLayerLike => DataLayer}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataSet, DataSetDAO, DataStoreInfo}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._

trait AnnotationContent {

  type Self <: AnnotationContent

  def service: AnnotationContentService

  def id: String

  def editPosition: Point3D

  def editRotation: Vector3D

  def zoomLevel: Double

  def boundingBox: Option[BoundingBox]

  def timestamp: Long

  def dataSetName: String

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[Self]

  def settings: AnnotationSettings

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def saveToDB(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def mergeWith(source: AnnotationContent, settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext): Fox[AnnotationContent]

  def contentType: String

  def toDownloadStream(name: String)(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]]

  def downloadFileExtension: String

  def contentData: Fox[JsObject] = Fox.empty

  lazy val date = new Date(timestamp)

  def dataSet(implicit ctx: DBAccessContext): Fox[DataSet] = DataSetDAO.findOneBySourceName(dataSetName)
}

object AnnotationContent extends FoxImplicits {

  import AnnotationSettings._

  import DataLayer.dataLayerLikeFormat

  implicit val dataSetWrites: Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataStore).write[DataStoreInfo] and
      (__ \ 'scale).write[Option[Scale]] and
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'dataLayers).write[Option[List[DataLayer]]]) (d =>
      (d.name, d.dataStoreInfo, d.dataSource.toUsable.map(_.scale), d.isPublic, d.dataSource.toUsable.map(_.dataLayers)))

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
        "editRotation" -> ac.editRotation,
        "boundingBox" -> ac.boundingBox,
        "contentType" -> ac.contentType)
    }
  }

  def writeParametersAsXML(
    ac: AnnotationContent,
    writer: XMLStreamWriter)(implicit ctx: DBAccessContext): Fox[Boolean] = {

    for {
      dataSet <- DataSetDAO.findOneBySourceName(ac.dataSetName)
      dataSource <- dataSet.dataSource.toUsable
    } yield {
      writer.writeStartElement("experiment")
      writer.writeAttribute("name", dataSet.name)
      writer.writeEndElement()
      writer.writeStartElement("scale")
      writer.writeAttribute("x", dataSource.scale.x.toString)
      writer.writeAttribute("y", dataSource.scale.y.toString)
      writer.writeAttribute("z", dataSource.scale.z.toString)
      writer.writeEndElement()
      writer.writeStartElement("offset")
      writer.writeAttribute("x", "0")
      writer.writeAttribute("y", "0")
      writer.writeAttribute("z", "0")
      writer.writeEndElement()
      writer.writeStartElement("time")
      writer.writeAttribute("ms", ac.timestamp.toString)
      writer.writeEndElement()
      writer.writeStartElement("editPosition")
      writer.writeAttribute("x", ac.editPosition.x.toString)
      writer.writeAttribute("y", ac.editPosition.y.toString)
      writer.writeAttribute("z", ac.editPosition.z.toString)
      writer.writeEndElement()
      writer.writeStartElement("editRotation")
      writer.writeAttribute("xRot", ac.editRotation.x.toString)
      writer.writeAttribute("yRot", ac.editRotation.y.toString)
      writer.writeAttribute("zRot", ac.editRotation.z.toString)
      writer.writeEndElement()
      writer.writeStartElement("zoomLevel")
      writer.writeAttribute("zoom", ac.zoomLevel.toString)
      writer.writeEndElement()
      true
    }
  }
}
