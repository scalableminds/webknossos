package models.tracing.volume

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import models.annotation.{AnnotationContent, AnnotationContentService, AnnotationLike, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary._
import java.io.{FileInputStream, InputStream, PipedInputStream, PipedOutputStream}
import java.nio.file.Paths
import java.util.zip.ZipInputStream
import javax.xml.stream.XMLStreamWriter

import scala.concurrent.Future
import models.tracing.CommonTracingService
import net.liftweb.common.{Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.iteratee.{Enumerator, Iteratee}
import play.api.libs.json.{JsValue, Json}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.ws.WS
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.io.{NamedEnumeratorStream, NamedFileStream, NamedFunctionStream, ZipIO}
import com.scalableminds.util.xml.{XMLWrites, Xml}
import models.tracing.skeleton.SkeletonTracing
import models.tracing.volume.VolumeTracing.VolumeTracingXMLWrites
import org.apache.commons.io.IOUtils
import oxalis.nml.{NML, NMLService, TreeLike}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
                          dataSetName: String,
                          userDataLayerName: String,
                          activeCellId: Option[Int] = None,
                          timestamp: Long = System.currentTimeMillis(),
                          editPosition: Point3D = Point3D(0, 0, 0),
                          editRotation: Vector3D = Vector3D(0, 0, 0),
                          zoomLevel: Double,
                          boundingBox: Option[BoundingBox] = None,
                          settings: AnnotationSettings = AnnotationSettings.volumeDefault,
                          _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent with FoxImplicits{

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[VolumeTracing] = {
    val updates = jsUpdates.flatMap { json =>
      TracingUpdater.createUpdateFromJson(json)
    }
    if (jsUpdates.size == updates.size) {
      for {
        updatedTracing <- updates.foldLeft(Fox.successful(this)) {
          case (f, updater) => f.flatMap(tracing => updater.update(tracing))
        }
        _ <- VolumeTracingDAO.update(updatedTracing._id, updatedTracing.copy(timestamp = System.currentTimeMillis))(GlobalAccessContext)
      } yield updatedTracing
    } else {
      Fox.empty
    }
  }

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext) = {
    // TODO: implement
    Fox.failure("Not yet implemented")
  }

  def mergeWith(source: AnnotationContent, settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext) = {
    // TODO: implement
    Fox.failure("Not yet implemented")
  }

  def saveToDB(implicit ctx: DBAccessContext) = {
    VolumeTracingService.saveToDB(this)
  }

  def contentType: String = VolumeTracing.contentType

  def toDownloadStream(name: String)(implicit ctx: DBAccessContext): Fox[Enumerator[Array[Byte]]] = {
    import play.api.Play.current
    def createStream(url: String): Fox[Enumerator[Array[Byte]]] = {
      val futureResponse = WS
        .url(url)
        .withQueryString("token" -> DataTokenService.oxalisToken)
        .getStream()

      futureResponse.map {
        case (headers, body) =>
          if(headers.status == 200) {
            Full(body)
          } else {
            Failure("Failed to retrieve content from data store. Status: " + headers.status)
          }
      }
    }

    for{
      dataSource <- DataSetDAO.findOneBySourceName(dataSetName) ?~> "dataSet.notFound"
      urlToVolumeData = s"${dataSource.dataStoreInfo.url}/data/datasets/$dataSetName/layers/$userDataLayerName/download"
      inputStream <- createStream(urlToVolumeData)
    } yield {
      Enumerator.outputStream{ outputStream =>
        ZipIO.zip(
          List(
            new NamedEnumeratorStream(inputStream, "data.zip"),
            new NamedFunctionStream(name + ".nml", os => NMLService.toNML(this, os)(VolumeTracingXMLWrites).futureBox.map(_ => Unit))
          ), outputStream)
      }
    }
  }

  def downloadFileExtension: String = ".zip"

  override def contentData = {
    UserDataLayerDAO.findOneByName(userDataLayerName)(GlobalAccessContext).map { userDataLayer =>
      Json.obj(
        "activeCell" -> activeCellId,
        "customLayers" -> List(AnnotationContent.dataLayerWrites.writes(userDataLayer.dataLayer)),
        "nextCell" -> userDataLayer.dataLayer.nextSegmentationId.getOrElse[Long](1),
        "zoomLevel" -> zoomLevel
      )
    }
  }
}

object VolumeTracingService extends AnnotationContentService with CommonTracingService with FoxImplicits {
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    VolumeTracingDAO.findOneById(id)

  def createFrom(baseDataSet: DataSet)(implicit ctx: DBAccessContext) = {
    for {
      baseSource <- baseDataSet.dataSource.toFox
      dataLayer <- DataStoreHandler.createUserDataLayer(baseDataSet.dataStoreInfo, baseSource)
      volumeTracing = VolumeTracing(baseDataSet.name, dataLayer.dataLayer.name, editPosition = baseDataSet.defaultStart, zoomLevel = VolumeTracing.defaultZoomLevel)
      _ <- UserDataLayerDAO.insert(dataLayer)
      _ <- VolumeTracingDAO.insert(volumeTracing)
    } yield {
      volumeTracing
    }
  }

  def createFrom(
    nmls: List[NML],
    additionalFiles: Map[String, TemporaryFile],
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[VolumeTracing] = {

    nmls.headOption.toFox.flatMap{ nml =>
      val box = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) }

      for {
        dataSet <- DataSetDAO.findOneBySourceName(nml.dataSetName) ?~> "dataSet.notFound"
        baseSource <- dataSet.dataSource.toFox ?~> "dataSource.notFound"
        start <- nml.editPosition.toFox.orElse(DataSetService.defaultDataSetPosition(nml.dataSetName))
        nmlVolume <- nml.volumes.headOption.toFox ?~> "nml.volume.notFound"
        volume <- additionalFiles.get(nmlVolume.location).toFox ?~> "nml.volume.volumeFileNotFound"
        dataLayer <- DataStoreHandler.uploadUserDataLayer(dataSet.dataStoreInfo, baseSource, volume) ?~> "dataStore.dataLayer.uploadFailed"
        volumeTracing = VolumeTracing(
          dataSet.name,
          dataLayer.dataLayer.name,
          editPosition = start,
          editRotation = nml.editRotation.getOrElse(Vector3D(0,0,0)),
          zoomLevel = nml.zoomLevel.getOrElse(VolumeTracing.defaultZoomLevel))
        _ <- UserDataLayerDAO.insert(dataLayer) ?~> "dataLayer.creation.failed"
        _ <- VolumeTracingDAO.insert(volumeTracing) ?~> "segmentation.creation.failed"
      } yield {
        volumeTracing
      }
    }
  }

  def saveToDB(volume: VolumeTracing)(implicit ctx: DBAccessContext) = {
    VolumeTracingDAO.update(
      Json.obj("_id" -> volume._id),
      Json.obj("$set" -> VolumeTracingDAO.formatter.writes(volume)),
      upsert = true).map { _ =>
      volume
    }
  }

  def clearAndRemove(id: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    ???
}

object VolumeTracing extends FoxImplicits{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"

  val defaultZoomLevel = 0.0

  implicit object VolumeTracingXMLWrites extends XMLWrites[VolumeTracing] with GlobalDBAccess {
    def writes(e: VolumeTracing)(implicit writer: XMLStreamWriter): Fox[Boolean] = {
      writer.writeStartElement("things")
      writer.writeStartElement("parameters")
      for{
        _ <- AnnotationContent.writeParametersAsXML(e, writer)
      } yield {
        e.activeCellId.foreach{id =>
          writer.writeStartElement("activeNodeId")
          writer.writeAttribute("id" , id.toString)
          writer.writeEndElement()
        }
        writer.writeEndElement() // end parameters
        writer.writeStartElement("volume")
        writer.writeAttribute("id" , "1")
        writer.writeAttribute("location" , "data.zip")
        writer.writeEndElement()
        writer.writeEndElement() // end things
        true
      }
    }
  }
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
