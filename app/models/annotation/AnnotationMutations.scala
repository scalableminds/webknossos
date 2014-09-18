package models.annotation

import com.scalableminds.util.io.NamedFileStream
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.Play
import java.io.{FileInputStream, FileOutputStream, InputStream, File}
import java.nio.channels.Channels
import com.scalableminds.util.reactivemongo.DBAccessContext
import oxalis.annotation.handler.SavedTracingInformationHandler
import models.tracing.skeleton.SkeletonTracingLike
import oxalis.nml.NMLService
import org.apache.commons.io.IOUtils
import play.api.libs.json.JsValue
import com.scalableminds.util.mvc.BoxImplicits
import models.user.{UserService, UsedAnnotationDAO, User}
import scala.concurrent.Future
import net.liftweb.common.{Failure, Box}
import scala.async.Async._
import scala.Some
import play.api.i18n.Messages
import models.task.TaskService
import controllers.Application
import com.scalableminds.util.mail.Send
import oxalis.mail.DefaultMails
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 21.01.14
 * Time: 14:06
 */
trait AnnotationMutationsLike{

  type AType <: AnnotationLike

  def resetToBase()(implicit ctx: DBAccessContext): Fox[AType]

  def reopen()(implicit ctx: DBAccessContext): Fox[AType]

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[AType]

  def cancelTask()(implicit ctx: DBAccessContext): Fox[AType]

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedFileStream]
}

class AnnotationMutations(val annotation: Annotation) extends AnnotationMutationsLike with AnnotationFileService with AnnotationContentProviders with BoxImplicits with FoxImplicits{
  type AType = Annotation

  def finishAnnotation(userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Future[Box[(Annotation, String)]] = async {
      annotation match {
        case annotation if annotation._task.isEmpty =>
          val updated = await(annotation.muta.finish().futureBox)
          updated.map(_ -> Messages("annotation.finished"))
        case annotation =>
          val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
          if (isReadyToBeFinished) {
            val updated = await(AnnotationDAO.finish(annotation._id).futureBox)
            updated.map(_ -> Messages("task.finished"))
          } else
            Failure(Messages("tracing.notEnoughNodes"))
      }
    }

    def tryToFinish(): Fox[(Annotation, String)] = {
      if (annotation.restrictions.allowFinish(userOpt)) {
        if (annotation.state.isInProgress) {
          executeFinish(annotation)
        } else
          Future.successful(Failure(Messages("annotation.notInProgress")))
      } else
        Future.successful(Failure(Messages("annotation.notPossible")))
    }

    tryToFinish().map {
      result =>
        annotation.muta.writeAnnotationToFile()
        UsedAnnotationDAO.removeAll(annotation.id)
        result
    }
  }

  def reopen()(implicit ctx: DBAccessContext) = {
    if (annotation.typ == AnnotationType.Task)
      AnnotationDAO.reopen(annotation._id)
    else
      Future.successful(None)
  }

  def finish()(implicit ctx: DBAccessContext) =
    AnnotationDAO.finish(annotation._id)

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def cancelTask()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
      _ <- TaskService.unassignOnce(task).toFox
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield annotation
  }

  def incrementVersion()(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def copyDeepAndInsert()(implicit ctx: DBAccessContext): Fox[Annotation] = {
    val copied = annotation.content.flatMap(content => content.copyDeepAndInsert)
    copied
    .map(_.id)
    .orElse(Fox.successful(annotation._content._id))
    .flatMap { contentId =>
      val copied = annotation.copy(
        _id = BSONObjectID.generate,
        _content = annotation._content.copy(_id = contentId))(_restrictions = None)

      AnnotationDAO.insert(copied).map(_ => copied)
    }
  }

  def resetToBase()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task.toFox
      annotationContent <- annotation.content
      tracingBase <- task.annotationBase.flatMap(_.content)
      reset <- tracingBase.copyDeepAndInsert.toFox
      _ <- annotationContent.service.clearTracingData(annotationContent.id)
      updatedAnnotation <- AnnotationDAO.updateContent(annotation._id, ContentReference.createFor(reset))
    } yield updatedAnnotation
  }

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext) = {
    annotation.content.flatMap(_.updateFromJson(js)).flatMap(_ =>
      AnnotationDAO.incrementVersion(annotation._id))
  }

  def transferToUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      updatedAnnotation <- AnnotationDAO.transfer(annotation._id, user._id)
    } yield updatedAnnotation
  }
}


trait AnnotationFileService extends FoxImplicits {

  def annotation: Annotation

  val conf = Play.current.configuration

  val defaultDownloadExtension = ".txt"

  def fileExtension(annotation: Annotation) =
    annotation.content.map(_.downloadFileExtension) getOrElse defaultDownloadExtension

  val annotationStorageFolder = {
    val folder = conf.getString("oxalis.annotation.storageFolder") getOrElse "data/nmls"
    new File(folder).mkdirs()
    folder
  }

  def outputPathForAnnotation() = fileExtension(annotation).map{ ext =>
    s"$annotationStorageFolder/${annotation.id}$ext"
  }

  def writeAnnotationToFile() {
    for {
      in: InputStream <- annotationToInputStream()
      path <- outputPathForAnnotation()
    } {
      val f = new File(path)
      val out = new FileOutputStream(f).getChannel
      val ch = Channels.newChannel(in)
      try {
        out.transferFrom(ch, 0, in.available)
      } finally {
        in.close()
        ch.close()
        out.close()
      }
    }
  }

  def loadAnnotationContentFromFileStream(): Fox[InputStream] = {
    if (annotation.state.isFinished) {
      outputPathForAnnotation().map{ path =>
        val f = new File(path)
        if (f.exists())
          Some(new FileInputStream(f))
        else
          None
      }
    } else
      None
  }

  def loadAnnotationContentStream(): Fox[InputStream] = {
    loadAnnotationContentFromFileStream().orElse {
      writeAnnotationToFile()
      loadAnnotationContentFromFileStream()
    }.orElse(annotationToInputStream())
  }

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedFileStream] = {
    for{
      annotationStream <- loadAnnotationContentStream()
      name <- SavedTracingInformationHandler.nameForAnnotation(annotation)
    } yield
      NamedFileStream( annotationStream, name + ".nml")
  }

  def annotationToInputStream(): Fox[InputStream] = {
    annotation.content.flatMap {
      case t: SkeletonTracingLike =>
        NMLService.toNML(t).map(IOUtils.toInputStream).toFox
      case _ =>
        throw new Exception("Invalid content!")
    }
  }
}
