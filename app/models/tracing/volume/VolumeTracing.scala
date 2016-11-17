package models.tracing.volume

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import models.annotation.{AnnotationContent, AnnotationContentService, AnnotationLike, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary._
import java.io.{FileInputStream, InputStream, PipedInputStream, PipedOutputStream}
import java.nio.file.Paths
import java.util.zip.ZipInputStream

import scala.concurrent.Future

import models.tracing.CommonTracingService
import net.liftweb.common.{Failure, Full}
import play.api.Logger
import play.api.libs.iteratee.{Enumerator, Iteratee}
import play.api.libs.json.{JsValue, Json}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext, GlobalDBAccess}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.ws.WS
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource, UserDataLayer}
import com.scalableminds.util.io.{NamedEnumeratorStream, NamedFileStream, ZipIO}
import com.scalableminds.util.xml.XMLWrites
import models.tracing.skeleton.SkeletonTracing
import models.tracing.volume.VolumeTracing.VolumeTracingXMLWrites
import org.apache.commons.io.IOUtils
import oxalis.nml.{NML, NMLService}
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

  private def enumeratorToIS(enumerator: Enumerator[Array[Byte]]): InputStream = {
    val pos = new PipedOutputStream()
    val pis = new PipedInputStream(pos)
    val it = Iteratee.foreach{b: Array[Byte] => pos.write(b)}
    enumerator.onDoneEnumerating(pos.close()) |>>> it
    pis
  }

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
      volumeNml <- NMLService.toNML(this)(VolumeTracingXMLWrites).map(data => Enumerator.fromStream(IOUtils.toInputStream(data)))
    } yield {
      Enumerator.outputStream{ outputStream =>
        ZipIO.zip(
          List(
            new NamedEnumeratorStream(inputStream, "data.zip"),
            new NamedEnumeratorStream(volumeNml, name + ".nml")
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
        dataSet <- DataSetDAO.findOneBySourceName(nml.dataSetName)
        baseSource <- dataSet.dataSource.toFox
        start <- nml.editPosition.toFox.orElse(DataSetService.defaultDataSetPosition(nml.dataSetName))
        nmlVolume <- nml.volumes.headOption.toFox
        volume <- additionalFiles.get(nmlVolume.location).toFox
        dataLayer <- DataStoreHandler.uploadUserDataLayer(dataSet.dataStoreInfo, baseSource, volume)
        volumeTracing = VolumeTracing(
          dataSet.name,
          dataLayer.dataLayer.name,
          editPosition = start,
          editRotation = nml.editRotation.getOrElse(Vector3D(0,0,0)),
          zoomLevel = nml.zoomLevel.getOrElse(VolumeTracing.defaultZoomLevel))
        _ <- UserDataLayerDAO.insert(dataLayer)
        _ <- VolumeTracingDAO.insert(volumeTracing)
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
    def writes(e: VolumeTracing): Fox[scala.xml.Node] = {
      for {
        parameters <- AnnotationContent.writeParametersAsXML(e)
      } yield {
        <things>
          <parameters>
            {parameters}
            {e.activeCellId.map(id => scala.xml.XML.loadString(s"""<activeNodeId id="$id"/>""")).getOrElse(scala.xml.Null)}
          </parameters>
          <volume id ="1" location="data.zip"></volume>
        </things>
      }
    }
  }
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
