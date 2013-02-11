package controllers.admin

import braingames.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user._
import nml._
import models.security.Role
import nml.NMLParser
import xml.Xml
import play.api.Logger
import scala.xml.PrettyPrinter
import models.tracing._
import play.api.i18n.Messages
import models.task.Project
import models.task.Task
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipOutputStream
import braingames.util.ZipIO
import java.io.StringReader
import java.io.InputStream
import org.xml.sax.InputSource
import play.api.mvc.SimpleResult
import play.api.mvc.ResponseHeader
import java.io.File
import play.api.libs.Files.TemporaryFile
import java.io.FileOutputStream
import org.apache.commons.io.IOUtils
import net.liftweb.common._

object NMLIO extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  val prettyPrinter = new PrettyPrinter(100, 2)
  
  def extractFromZip(file: File): List[NML] =
    ZipIO.unzip(file).map(nml => (new NMLParser(nml)).parse).flatten

  def extractFromNML(file: File) =
    new NMLParser(file).parse

  def extractFromFile(file: File, fileName: String): List[NML] = {
    if (fileName.endsWith(".zip")) {
      Logger.trace("Extracting from ZIP file")
      extractFromZip(file)
    } else {
      Logger.trace("Extracting from NML file")
      List(extractFromNML(file)).flatten
    }
  }
  
  def uploadForm = Authenticated { implicit request =>
    Ok(html.admin.nml.nmlupload())
  }

  def upload = Authenticated(parse.multipartFormData) { implicit request =>
    request.body.file("nmlFile").flatMap { nmlFile =>
      extractFromNML(nmlFile.ref.file)
        .map { nml =>
          println("NML: " + nml.trees.size + " Nodes: " + nml.trees.head.nodes.size)
          Logger.debug("Successfully parsed nmlFile")
          val tracing = Tracing.createFromNMLFor(request.user._id, nml, TracingType.Explorational)
          UsedTracings.use(request.user, tracing)
          tracing
        }
        .headOption
        .map { tracing =>
          Redirect(controllers.routes.Game.trace(tracing.id)).flashing(
            "success" -> Messages("nml.file.uploadSuccess"))
        }
    }.getOrElse {
      Redirect(controllers.routes.UserController.dashboard).flashing(
        "error" -> Messages("nml.file.invalid"))
    }
  }

  def download(tracingId: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if !Task.isTrainingsTracing(tracing)
    } yield {
      Ok(prettyPrinter.format(Xml.toXML(tracing))).withHeaders(
        CONTENT_TYPE -> "application/octet-stream",
        CONTENT_DISPOSITION -> ("attachment; filename=%s.nml".format(tracing.dataSetName)))
    }) ?~ Messages("tracing.training.notFound")
  }

  def projectDownload(projectName: String) = Authenticated(role = Role.Admin) { implicit request =>
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
    } yield {
      val tasksWithtracings = Task
        .findAllByProject(project.name)
        .map(task => task -> task.tracings.filter(_.state.isFinished))
      val zipStreams = tasksWithtracings.flatMap {
        case (task, tracings) => tracings.map { tracing =>
          val xml = prettyPrinter.format(Xml.toXML(tracing))
          (IOUtils.toInputStream(xml, "UTF-8") -> (s"${task.id}_${tracing.id}.nml"))
        }
      }
      val zipped = new TemporaryFile(new File(projectName + "_nmls.zip"))
      ZipIO.zip(zipStreams, new BufferedOutputStream(new FileOutputStream(zipped.file)))
      Ok.sendFile(zipped.file)
    }
  }

  def taskDownload(taskId: String) = Authenticated(role = Role.Admin) { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
    } yield {
      val tasksWithtracings = task.tracings.filter(_.state.isFinished)
      val zipStreams = tasksWithtracings.map { tracing =>
        val xml = prettyPrinter.format(Xml.toXML(tracing))
        (IOUtils.toInputStream(xml, "UTF-8") -> (s"${task.id}_${tracing.id}.nml"))
      }
      val zipped = new TemporaryFile(new File(task.id + "_nmls.zip"))
      ZipIO.zip(zipStreams, new BufferedOutputStream(new FileOutputStream(zipped.file)))
      Ok.sendFile(zipped.file)
    }
  }
}