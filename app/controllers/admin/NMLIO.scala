package controllers.admin

import play.api.mvc.Action
import oxalis.security.{AuthenticatedRequest, Secured}
import views.html
import models.user._
import oxalis.nml._
import models.security.{RoleDAO, Role}
import oxalis.nml.NMLParser
import braingames.xml.Xml
import play.api.Logger
import scala.xml.PrettyPrinter
import models.tracing._
import play.api.i18n.Messages
import models.task.{TaskDAO, ProjectDAO, Project, Task}
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipOutputStream
import braingames.util._
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
import java.io.FileInputStream
import java.nio.channels.Channels
import models.annotation._
import models.annotation.AnnotationType._
import models.tracing.skeleton.{SkeletonTracing, SkeletonTracingLike}
import oxalis.annotation.handler.SavedTracingInformationHandler
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.Play
import controllers.Controller
import net.liftweb.common.Full
import oxalis.nml.NML
import models.annotation.AnnotationType
import models.annotation.Annotation
import org.bson.types.ObjectId
import net.liftweb.common.Full
import oxalis.nml.NML

object NMLIO extends Controller with Secured with TextUtils {
  override val DefaultAccessRole = RoleDAO.User


  def uploadForm = Authenticated() { implicit request =>
    Ok(html.admin.nml.nmlupload())
  }

  private def nameForNMLs(fileNames: Seq[String]) =
    if (fileNames.size == 1)
      fileNames.headOption
    else
      None

  def splitResult(r: Seq[(String, Box[NML])]) = {
    r.foldLeft((List[String](), List[(String, NML)]())) {
      case ((failed, successful), (fileName, nmlBox)) =>
        nmlBox match {
          case Full(nml) =>
            (failed, (fileName -> nml) :: successful)
          case _ =>
            (fileName :: failed, successful)
        }
    }
  }

  def createAnnotationFrom(user: User, nmls: List[NML], typ: AnnotationType, name: Option[String])(implicit request: AuthenticatedRequest[_]): Fox[Annotation] = {
    SkeletonTracing.createFrom(nmls, AnnotationSettings.default).map {
      content =>
        AnnotationService.createFrom(
          new ObjectId(user._id.stringify),
          content,
          typ,
          name)
    }.getOrElse(Future.successful(None)).toFox
  }

  def upload = Authenticated().async(parse.multipartFormData) { implicit request =>
    val parseResult = request.body.files.map(f => f.filename -> NMLService.extractFromNML(f.ref.file))
    val (parseFailed, parseSuccess) = splitResult(parseResult)
    if (parseFailed.size > 0) {
      val errors = parseFailed.map {
        fileName =>
          "error" -> Messages("nml.file.invalid", fileName)
      }
      Future.successful(Redirect(controllers.routes.UserController.dashboard)
                        .flashing(errors: _*))
    } else if (parseSuccess.size == 0) {
      Future.successful(Redirect(controllers.routes.UserController.dashboard)
                        .flashing("error" -> Messages("nml.file.noFile")))
    } else {
      val tracingName = nameForNMLs(parseSuccess.map {
        case (fileName, _) => fileName
      })
      val nmls = parseSuccess.map {
        case (_, nml) => nml
      }

      createAnnotationFrom(request.user, nmls, AnnotationType.Explorational, tracingName)
      .map {
        annotation =>
          Redirect(controllers.routes.AnnotationController.trace(annotation.typ, annotation.id))
          .flashing(
            "success" -> Messages("nml.file.uploadSuccess"))
      }
      .getOrElse(
        Redirect(controllers.routes.UserController.dashboard)
        .flashing(
          "error" -> Messages("nml.file.invalid")))
    }
  }

  def zipTracings(annotations: List[Annotation], zipFileName: String)(implicit request: AuthenticatedRequest[_]) = {
    Future.sequence(annotations.par.map(AnnotationService.loadAnnotationContent(_).futureBox).seq).map {
      zipStreams =>
        val zipped = TemporaryFile("annotationZips", normalize(zipFileName))
        ZipIO.zip(zipStreams.flatten, new BufferedOutputStream(new FileOutputStream(zipped.file)))
        zipped
    }
  }

  def projectDownload(projectName: String) = Authenticated(role = RoleDAO.Admin).async { implicit request =>
    def createProjectZip(project: Project) =
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        tracings <- Future.traverse(tasks)(_.annotations).map(_.flatten.filter(_.state.isFinished))
        zip <- zipTracings(tracings, normalize(projectName + "_nmls.zip"))
      } yield zip

    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
      zip <- createProjectZip(project)
    } yield {
      Ok.sendFile(zip.file)
    }
  }

  def taskDownload(taskId: String) = Authenticated(role = RoleDAO.Admin).async { implicit request =>
    def createTaskZip(task: Task) = task.annotations.flatMap { annotations =>
      val finished = annotations.filter(_.state.isFinished)
      zipTracings(finished, normalize(task.id + "_nmls.zip"))
    }

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      zip <- createTaskZip(task)
    } yield Ok.sendFile(zip.file)
  }

  def userDownload(userId: String) = Authenticated(role = RoleDAO.Admin).async { implicit request =>
    for {
      user <- UserService.findOneById(userId, useCache = true) ?~> Messages("user.notFound")
      annotations <- AnnotationService.findTasksOf(user).map(_.filter(_.state.isFinished))
      zipped <- zipTracings(annotations, normalize(user.abreviatedName + "_nmls.zip"))
    } yield {
      Ok.sendFile(zipped.file)
    }
  }
}