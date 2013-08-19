package controllers.admin

import braingames.mvc.Controller
import play.api.mvc.Action
import oxalis.security.Secured
import views.html
import models.user._
import oxalis.nml._
import models.security.Role
import oxalis.nml.NMLParser
import braingames.xml.Xml
import play.api.Logger
import scala.xml.PrettyPrinter
import models.tracing._
import play.api.i18n.Messages
import models.task.Project
import models.task.Task
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipOutputStream
import braingames.util.{NamedFileStream, ZipIO, TextUtils, FileIO}
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
import models.annotation.{AnnotationSettings, AnnotationDAO, Annotation, AnnotationType}
import models.annotation.AnnotationType._
import models.tracing.skeleton.{SkeletonTracing, SkeletonTracingLike}
import oxalis.annotation.handler.SavedTracingInformationHandler
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.Play
import org.bson.types.ObjectId
import oxalis.annotation.AnnotationService

object NMLIO extends Controller with Secured with TextUtils {
  override val DefaultAccessRole = Role.User


  def uploadForm = Authenticated {
    implicit request =>
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

  def createAnnotationFrom(user: User, nmls: List[NML], typ: AnnotationType, name: Option[String]) = {
    SkeletonTracing.createFrom(nmls, AnnotationSettings.default).map {
      content =>
        AnnotationDAO.createFrom(
          user._id,
          content,
          typ,
          name)
    }
  }

  def upload = Authenticated(parse.multipartFormData) {
    implicit request =>
      val parseResult = request.body.files.map(f => f.filename -> NMLService.extractFromNML(f.ref.file))
      val (parseFailed, parseSuccess) = splitResult(parseResult)
      if (parseFailed.size > 0) {
        val errors = parseFailed.map {
          fileName =>
            "error" -> Messages("nml.file.invalid", fileName)
        }
        Redirect(controllers.routes.UserController.dashboard)
          .flashing(
          errors: _*)
      } else if (parseSuccess.size == 0) {
        Redirect(controllers.routes.UserController.dashboard)
          .flashing(
          "error" -> Messages("nml.file.noFile"))
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

  def zipTracings(annotations: List[Annotation], zipFileName: String) = {
    Future.sequence(annotations.par.flatMap(AnnotationService.loadAnnotationContent).seq).map {
      zipStreams =>
        val zipped = new TemporaryFile(new File(normalize(zipFileName)))
        ZipIO.zip(zipStreams, new BufferedOutputStream(new FileOutputStream(zipped.file)))
        zipped
    }
  }

  def projectDownload(projectName: String) = Authenticated(role = Role.Admin) {
    implicit request =>
      Async {
        for {
          project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
        } yield {
          val t = System.currentTimeMillis()
          val tracings = Task
            .findAllByProject(project.name)
            .flatMap(_.annotations.filter(_.state.isFinished))

          zipTracings(tracings, normalize(projectName + "_nmls.zip")).map {
            zipped =>
              Logger.debug(s"Zipping took: ${System.currentTimeMillis - t} ms")
              Ok.sendFile(zipped.file)
          }
        }
      }
  }

  def taskDownload(taskId: String) = Authenticated(role = Role.Admin) {
    implicit request =>
      Async {
        for {
          task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
        } yield {
          val annotations = task.annotations.filter(_.state.isFinished)
          zipTracings(annotations, normalize(task.id + "_nmls.zip")).map {
            zipped =>
              Ok.sendFile(zipped.file)
          }
        }
      }
  }

  def userDownload(userId: String) = Authenticated(role = Role.Admin) {
    implicit request =>
      Async {
        for {
          user <- User.findOneById(userId) ?~ Messages("user.notFound")
        } yield {
          val annotations = AnnotationDAO.findFor(user, AnnotationType.Task).filter(_.state.isFinished)
          zipTracings(annotations, normalize(user.abreviatedName + "_nmls.zip")).map {
            zipped =>
              Ok.sendFile(zipped.file)
          }
        }
      }
  }
}