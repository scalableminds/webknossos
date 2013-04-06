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
import braingames.util.TextUtils
import braingames.util.FileIO
import java.io.FileInputStream
import java.nio.channels.Channels
import controllers.tracing.handler.SavedTracingInformationHandler

object NMLIO extends Controller with Secured with TextUtils {
  override val DefaultAccessRole = Role.User

  val prettyPrinter = new PrettyPrinter(100, 2)

  val baseTracingOutputDir = {
    val folder = "data/nmls"
    new File(folder).mkdirs()
    folder
  }

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

  def outputPathForTracing(tracing: Tracing) =
    s"$baseTracingOutputDir/${tracing.id}.nml"

  def writeTracingToFile(tracing: Tracing) {
    val f = new File(outputPathForTracing(tracing))
    val out = new FileOutputStream(f).getChannel
    val in = tracingToNMLStream(tracing)
    val ch = Channels.newChannel(in)
    try {
      out.transferFrom(ch, 0, in.available)
    } finally { out.close() }
  }

  def tracingToNMLStream(tracing: Tracing) = {
    IOUtils.toInputStream(toXML(tracing))
  }

  def loadTracingFromFileStream(tracing: Tracing) = {
    if (tracing.state.isFinished) {
      val f = new File(outputPathForTracing(tracing))
      if (f.exists())
        Some(new FileInputStream(f))
      else
        None
    } else
      None
  }

  def loadTracingStream(tracing: Tracing) = {
    loadTracingFromFileStream(tracing) orElse {
      writeTracingToFile(tracing)
      loadTracingFromFileStream(tracing)
    }
  }

  def uploadForm = Authenticated { implicit request =>
    Ok(html.admin.nml.nmlupload())
  }

  private def nameForNMLs(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption
    else
      None

  def upload = Authenticated(parse.multipartFormData) { implicit request =>
    val parseResult = request.body.files.map(f => f.filename -> extractFromNML(f.ref.file))
    if (parseResult.size > 0) {
      parseResult.find(_._2.isEmpty) match {
        case None =>
          val tracingName = nameForNMLs(parseResult.map(_._1))

          val nmls = parseResult.map(_._2.open_!).toList

          val tracingOpt = Tracing.createFromNMLsFor(
            request.user._id,
            nmls,
            TracingType.Explorational,
            tracingName)

          tracingOpt
            .map { tracing =>
              Redirect(controllers.routes.TracingController.trace(tracing.id)).flashing(
                "success" -> Messages("nml.file.uploadSuccess"))
            }
            .getOrElse(
              Redirect(controllers.routes.UserController.dashboard).flashing(
                "error" -> Messages("nml.file.invalid")))
        case Some((fileName, _)) =>
          Redirect(controllers.routes.UserController.dashboard).flashing(
            "error" -> Messages("nml.file.invalid", fileName))
      }
    } else {
      Redirect(controllers.routes.UserController.dashboard).flashing(
        "error" -> Messages("nml.file.noFile"))
    }
  }

  def toXML[T <: TracingLike](t: T) = {
    prettyPrinter.format(Xml.toXML(t))
  }

  def zipTracings(tracings: List[Tracing], zipFileName: String) = {
    val zipStreams = tracings.par.map { tracing =>
      val tracingStream =
        loadTracingStream(tracing) getOrElse tracingToNMLStream(tracing)
      tracingStream -> (SavedTracingInformationHandler.nameForTracing(tracing) + ".nml")
    }.seq
    val zipped = new TemporaryFile(new File(normalize(zipFileName)))
    ZipIO.zip(zipStreams, new BufferedOutputStream(new FileOutputStream(zipped.file)))
    zipped
  }

  def projectDownload(projectName: String) = Authenticated(role = Role.Admin) { implicit request =>
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
    } yield {
      val t = System.currentTimeMillis()
      val tracings = Task
        .findAllByProject(project.name)
        .flatMap(_.tracings.filter(_.state.isFinished))

      val zipped = zipTracings(tracings, projectName + "_nmls.zip")
      Logger.debug(s"Zipping took: ${System.currentTimeMillis - t} ms")
      Ok.sendFile(zipped.file)
    }
  }

  def taskDownload(taskId: String) = Authenticated(role = Role.Admin) { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
    } yield {
      val tracings = task.tracings.filter(_.state.isFinished)
      val zipped = zipTracings(tracings, task.id + "_nmls.zip")
      Ok.sendFile(zipped.file)
    }
  }

  def userDownload(userId: String) = Authenticated(role = Role.Admin) { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      val tracings = Tracing.findFor(user, TracingType.Task).filter(_.state.isFinished)
      val zipped = zipTracings(tracings, user.abreviatedName + "_nmls.zip")
      Ok.sendFile(zipped.file)
    }
  }
}