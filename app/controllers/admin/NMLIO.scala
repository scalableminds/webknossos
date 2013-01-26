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

object NMLIO extends Controller with Secured {
  override val DefaultAccessRole = Role.User
  
  val prettyPrinter = new PrettyPrinter(100, 2)
  // TODO remove comment in production
  // override val DefaultAccessRole = Role( "admin" )

  def extractFromZip(file: File): Box[Iterator[Nml]] = {
    val nmls = ZipIO.unzip(file).map(nml => (new NMLParser(nml)).parse)
    nmls.find( _.isEmpty) orElse Full(nmls)
  }
  
  def extractFromNML(file: File) = 
    new NMLParser(file).parse
    
  def extractFromFile(file: File): Box[Iterator[Nml]] = {
    if(file.getName().endsWith(".zip")){
      extractFromZip(file)
    } else
      extractFromNML(file).map(r => List(r))
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
          val tracing = Tracing.createFromNMLFor(request.user, nml, TracingType.Explorational)
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
      if !tracing.isTrainingsTracing
    } yield {
      Ok(prettyPrinter.format(Xml.toXML(tracing))).withHeaders(
        CONTENT_TYPE -> "application/octet-stream",
        CONTENT_DISPOSITION -> ("attachment; filename=%s.nml".format(tracing.dataSetName)))
    }) ?~ Messages("tracing.training.notFound")
  }
  
  def projectDownload(projectName: String) = Authenticated { implicit request =>
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
    } yield {
      val tracings = Task.findAllByProject(project.name).flatMap(_.tracings)
      val zipStreams = tracings.map{tracing => 
        val xml = prettyPrinter.format(Xml.toXML(tracing))
        (IOUtils.toInputStream(xml, "UTF-8") -> (tracing._id+".nml"))
      }
      val zipped = new TemporaryFile(new File(projectName + "_nmls.zip"))
      ZipIO.zip(zipStreams, new BufferedOutputStream(new FileOutputStream(zipped.file)))
      
      Ok.sendFile(zipped.file)
    }
  }

}