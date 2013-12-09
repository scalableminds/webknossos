package models.annotation

import models.user.{UserService, UsedAnnotationDAO, UsedAnnotation, User}
import braingames.reactivemongo.DBAccessContext
import net.liftweb.common.{Failure, Full, Box}
import play.api.i18n.Messages
import play.api.Play
import java.io.{InputStream, FileInputStream, FileOutputStream, File}
import java.nio.channels.Channels
import scala.concurrent.Future
import braingames.util.{FoxImplicits, Fox, NamedFileStream}
import oxalis.annotation.handler.SavedTracingInformationHandler
import models.tracing.skeleton.{SkeletonTracing, SkeletonTracingLike}
import oxalis.nml.{NML, NMLService}
import org.apache.commons.io.IOUtils
import play.api.libs.concurrent.Execution.Implicits._
import models.basics.Implicits._
import models.task.{Training, Task, TaskService}
import org.bson.types.ObjectId
import scala.async.Async._
import braingames.geometry.Point3D
import braingames.binary.models.DataSet
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationType._
import scala.Some
import net.liftweb.common.Full
import braingames.util.NamedFileStream
import braingames.binary.models.DataSet
import oxalis.nml.NML
import play.api.libs.json.JsValue
import controllers.Application
import scala.Application
import braingames.mail.Send
import oxalis.mail.DefaultMails
import braingames.mvc.BoxImplicits

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 12:39
 */
object AnnotationService extends AnnotationFileService with AnnotationContentProviders with BoxImplicits {
  def finishAnnotation(user: User, annotation: Annotation)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Future[Box[(Annotation, String)]] = async {
      annotation match {
        case annotation if annotation._task.isEmpty =>
          val updated = await(AnnotationService.finish(annotation))
          updated.map(_ -> Messages("annotation.finished"))
        case annotation =>
          val isTraining = await(annotation.isTrainingsAnnotation())
          val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
          if (isTraining) {
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
        AnnotationService.writeAnnotationToFile(annotation)
        UsedAnnotationDAO.removeAll(annotation.id)
        result
    }
  }

  def reopen(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    if (annotation.typ == AnnotationType.Task)
      AnnotationDAO.reopen(annotation._id)
    else
      Future.successful(None)
  }

  def unassignReviewer(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    AnnotationDAO.unassignReviewer(annotation._id)
  }

  def finish(annotation: Annotation)(implicit ctx: DBAccessContext) =
    AnnotationDAO.finish(annotation._id)

  def rename(annotation: Annotation, name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def baseFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.TracingBase).one[Annotation].toFox

  def annotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.Task).cursor[Annotation].collect[List]()

  def cancelTask(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
      _ <- TaskService.unassignOnce(task)
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield true
  }

  def finishReview(annotation: Annotation, review: AnnotationReview, passed: Boolean, comment: String)(implicit ctx: DBAccessContext) = {
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

  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String)(implicit ctx: DBAccessContext) =
    withProviderForContentType(contentType) { provider =>
      val content = provider.createFrom(dataSet)
      val annotation = Annotation(
        user._id,
        ContentReference.createFor(content),
        typ = AnnotationType.Explorational,
        state = AnnotationState.InProgress
      )
      AnnotationDAO.insert(annotation).map { _ =>
        annotation
      }
    }

  def freeAnnotationsOfUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      annotations <- AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task).collect[List]()
      _ = annotations.map(annotation => cancelTask(annotation))
      result <- AnnotationDAO.unassignAnnotationsOfUser(user._id)
    } yield result
  }

  def openExplorationalFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Explorational)

  def openTasksFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task).collect[List]()

  def countOpenTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countOpenAnnotations(user._id, AnnotationType.Task)

  def hasAnOpenTask(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.hasAnOpenAnnotation(user._id, AnnotationType.Task)

  def findTasksOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFor(user._id, AnnotationType.Task)

  def findExploratoryOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findForWithTypeOtherThan(user._id, AnnotationType.Task :: AnnotationType.SystemTracings)


  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      copyDeepAndInsert(annotation.copy(
        _user = new ObjectId(user._id.stringify),
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task))

    for {
      annotationBase <- task.annotationBase
      _ <- TaskService.assignOnce(task).toFox
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def incrementVersion(annotation: Annotation)(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, dataSetName: String, start: Point3D)(implicit ctx: DBAccessContext) = {
    val tracing = SkeletonTracing.createFrom(dataSetName, start, true, settings)
    val content = ContentReference.createFor(tracing)
    AnnotationDAO.insert(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
  }

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, nml: NML)(implicit ctx: DBAccessContext) = {
    SkeletonTracing.createFrom(nml, settings).map {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insert(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }
  }

  def createSample(annotation: Annotation, _task: BSONObjectID)(implicit ctx: DBAccessContext): Future[Option[Annotation]] = {
    copyDeepAndInsert(annotation.copy(
      typ = AnnotationType.Sample,
      _task = Some(_task)))
  }

  def createFrom(_user: BSONObjectID, content: AnnotationContent, annotationType: AnnotationType, name: Option[String])(implicit ctx: DBAccessContext) = {
    val annotation = Annotation(
      _user,
      ContentReference.createFor(content),
      _name = name,
      typ = annotationType)

    AnnotationDAO.insert(annotation).map { _ =>
      Some(annotation)
    }
  }

  def copyDeepAndInsert(source: Annotation)(implicit ctx: DBAccessContext): Future[Option[Annotation]] = {
    val copied = source.content.map(content => content.copyDeepAndInsert)
    copied
    .map(_.id)
    .getOrElse(source._content._id)
    .flatMap { contentId =>
      val copied = source.copy(
        _id = BSONObjectID.generate,
        _content = source._content.copy(_id = contentId))

      AnnotationDAO.insert(copied).map(_ => Some(copied))
    }
  }

  def createReviewFor(sample: Annotation, training: Annotation, user: User)(implicit ctx: DBAccessContext) = {
    for {
      reviewContent <- training.content.map(_.copyDeepAndInsert)
      sampleContent <- sample.content
    } yield {
      reviewContent.mergeWith(sampleContent)
      val review = training.copy(
        _id = BSONObjectID.generate,
        _user = user._id,
        state = AnnotationState.Assigned,
        typ = AnnotationType.Review,
        _content = training._content.copy(_id = reviewContent.id)
      )
      AnnotationDAO.insert(review)
      review
    }
  }

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task.toFox
      annotationContent <- annotation.content
      tracingBase <- task.annotationBase.flatMap(_.content)
      reseted = tracingBase.copyDeepAndInsert
      _ = annotationContent.clearTracingData()
      updatedAnnotation <- AnnotationDAO.updateContent(annotation._id, ContentReference.createFor(reseted))
    } yield {
      updatedAnnotation
    }
  }

  def updateFromJson(js: Seq[JsValue], annotation: Annotation)(implicit ctx: DBAccessContext) = {
    annotation.content.flatMap(_.updateFromJson(js)).flatMap(_ =>
      AnnotationDAO.incrementVersion(annotation._id))
  }

  def assignReviewer(training: Annotation, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      task <- training.task
      sampleId <- task.training.map(_.sample).toFox
      sample <- AnnotationDAO.findOneById(sampleId).toFox
      reviewAnnotation <- createReviewFor(sample, training, user)
      review = AnnotationReview(user._id, reviewAnnotation._id, System.currentTimeMillis())
      result <- AnnotationDAO.assignReviewer(training._id, review)
    } yield result
  }
}

trait AnnotationFileService extends FoxImplicits {

  val conf = Play.current.configuration

  val defaultDownloadExtension = ".txt"

  def fileExtension(annotation: Annotation) =
    annotation.content.map(_.downloadFileExtension) getOrElse defaultDownloadExtension

  val annotationStorageFolder = {
    val folder = conf.getString("oxalis.annotation.storageFolder") getOrElse "data/nmls"
    new File(folder).mkdirs()
    folder
  }

  def outputPathForAnnotation(annotation: Annotation) =
    s"$annotationStorageFolder/${
      annotation.id
    }${fileExtension(annotation)}"

  def writeAnnotationToFile(annotation: Annotation) {
    for {
      in: InputStream <- annotationToInputStream(annotation)
    } {
      val f = new File(outputPathForAnnotation(annotation))
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

  def loadAnnotationContentFromFileStream(annotation: Annotation): Fox[InputStream] = {
    if (annotation.state.isFinished) {
      val f = new File(outputPathForAnnotation(annotation))
      if (f.exists())
        Some(new FileInputStream(f))
      else
        None
    } else
      None
  }

  def loadAnnotationContentStream(annotation: Annotation): Fox[InputStream] = {
    loadAnnotationContentFromFileStream(annotation).orElse {
      writeAnnotationToFile(annotation)
      loadAnnotationContentFromFileStream(annotation)
    }.orElse(annotationToInputStream(annotation))
  }

  def loadAnnotationContent(annotation: Annotation)(implicit ctx: DBAccessContext) =
    loadAnnotationContentStream(annotation).map {
      annotationStream =>
        NamedFileStream(
          annotationStream,
          SavedTracingInformationHandler.nameForAnnotation(annotation) + ".nml")
    }

  def annotationToInputStream(annotation: Annotation): Fox[InputStream] = {
    annotation.content.flatMap {
      case t: SkeletonTracingLike =>
        NMLService.toNML(t).map(IOUtils.toInputStream).toFox
      case _ =>
        throw new Exception("Invalid content!")
    }
  }
}