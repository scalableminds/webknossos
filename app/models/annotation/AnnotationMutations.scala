package models.annotation

import braingames.util.{NamedFileStream, Fox, FoxImplicits}
import play.api.Play
import java.io.{FileInputStream, FileOutputStream, InputStream, File}
import java.nio.channels.Channels
import braingames.reactivemongo.DBAccessContext
import oxalis.annotation.handler.SavedTracingInformationHandler
import models.tracing.skeleton.SkeletonTracingLike
import oxalis.nml.NMLService
import org.apache.commons.io.IOUtils
import play.api.libs.json.JsValue
import braingames.mvc.BoxImplicits
import models.user.{UserService, UsedAnnotationDAO, User}
import scala.concurrent.Future
import net.liftweb.common.{Failure, Box}
import scala.async.Async._
import scala.Some
import braingames.util.NamedFileStream
import play.api.i18n.Messages
import models.task.{Training, TaskService}
import controllers.Application
import braingames.mail.Send
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

  def unassignReviewer()(implicit ctx: DBAccessContext): Fox[AType]
}

class AnnotationMutations(val annotation: Annotation) extends AnnotationMutationsLike with AnnotationFileService with AnnotationContentProviders with BoxImplicits with FoxImplicits{
  type AType = Annotation

  def finishAnnotation(user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Future[Box[(Annotation, String)]] = async {
      annotation match {
        case annotation if annotation._task.isEmpty =>
          val updated = await(annotation.muta.finish())
          updated.map(_ -> Messages("annotation.finished"))
        case annotation =>
          val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
          if (annotation.isTrainingsAnnotation) {
            val updated = await(AnnotationDAO.passToReview(annotation._id))
            updated.map(_ -> Messages("task.passedToReview"))
          } else if (isReadyToBeFinished) {
            val updated = await(AnnotationDAO.finish(annotation._id))
            updated.map(_ -> Messages("task.finished"))
          } else
            Failure(Messages("tracing.notEnoughNodes"))
      }
    }

    def tryToFinish(): Fox[(Annotation, String)] = {
      if (annotation.restrictions.allowFinish(user)) {
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

  def unassignReviewer()(implicit ctx: DBAccessContext) = {
    AnnotationDAO.unassignReviewer(annotation._id)
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

  def finishReview(review: AnnotationReview, passed: Boolean, comment: String)(implicit ctx: DBAccessContext) = {
    def handleFinish(trainee: User, training: Training) =
      if (passed)
        handlePassed(trainee, training)
      else
        handleFailed(trainee, training)

    def handlePassed(trainee: User, training: Training) =
      for {
        _ <- UserService.increaseExperience(trainee._id, training.domain, training.gain)
        _ <- AnnotationDAO.addReviewComment(annotation._id, comment)
        _ <- AnnotationDAO.finish(annotation._id)
      } yield {
        Application.Mailer ! Send(
          DefaultMails.trainingsSuccessMail(trainee.name, trainee.email, comment))
      }

    def handleFailed(trainee: User, training: Training) =
      for {
        _ <- AnnotationDAO.addReviewComment(annotation._id, comment)
        _ <- AnnotationDAO.reopen(annotation._id)
      } yield {
        Application.Mailer ! Send(
          DefaultMails.trainingsFailureMail(trainee.name, trainee.email, comment))
      }

    for {
      task <- annotation.task ?~> Messages("annotation.task.notFound")
      training <- task.training ?~> Messages("annotation.training.notFound")
      trainee <- annotation.user ?~> Messages("annotation.user.notFound")
      _ <- handleFinish(trainee, training)
      _ <- AnnotationDAO.finish(review.reviewAnnotation)
    } yield {
      true
    }
  }

  def incrementVersion()(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def copyDeepAndInsert()(implicit ctx: DBAccessContext): Future[Option[Annotation]] = {
    val copied = annotation.content.flatMap(content => content.copyDeepAndInsert)
    copied
    .map(_.id)
    .getOrElse(annotation._content._id)
    .flatMap { contentId =>
      val copied = annotation.copy(
        _id = BSONObjectID.generate,
        _content = annotation._content.copy(_id = contentId))

      AnnotationDAO.insert(copied).map(_ => Some(copied))
    }
  }

  def createReviewFor(sample: Annotation, user: User)(implicit ctx: DBAccessContext) = {
    for {
      content <- annotation.content
      reviewContent <- content.copyDeepAndInsert.toFox
      sampleContent <- sample.content
    } yield {
      reviewContent.mergeWith(sampleContent)
      val review = annotation.copy(
        _id = BSONObjectID.generate,
        _user = user._id,
        state = AnnotationState.Assigned,
        typ = AnnotationType.Review,
        _content = annotation._content.copy(_id = reviewContent.id)
      )
      AnnotationDAO.insert(review)
      review
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

  def assignReviewer(user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      task <- annotation.task
      sampleId <- task.training.map(_.sample).toFox
      sample <- AnnotationDAO.findOneById(sampleId).toFox
      reviewAnnotation <- annotation.muta.createReviewFor(sample, user)
      review = AnnotationReview(user._id, reviewAnnotation._id, System.currentTimeMillis())
      result <- AnnotationDAO.assignReviewer(annotation._id, review)
    } yield result
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

  def outputPathForAnnotation() =
    s"$annotationStorageFolder/${
      annotation.id
    }${fileExtension(annotation)}"

  def writeAnnotationToFile() {
    for {
      in: InputStream <- annotationToInputStream()
    } {
      val f = new File(outputPathForAnnotation())
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
      val f = new File(outputPathForAnnotation())
      if (f.exists())
        Some(new FileInputStream(f))
      else
        None
    } else
      None
  }

  def loadAnnotationContentStream(): Fox[InputStream] = {
    loadAnnotationContentFromFileStream().orElse {
      writeAnnotationToFile()
      loadAnnotationContentFromFileStream()
    }.orElse(annotationToInputStream())
  }

  def loadAnnotationContent()(implicit ctx: DBAccessContext) =
    loadAnnotationContentStream().map {
      annotationStream =>
        NamedFileStream(
          annotationStream,
          SavedTracingInformationHandler.nameForAnnotation(annotation) + ".nml")
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