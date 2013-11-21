package models.annotation

import models.user.{UsedAnnotationDAO, UsedAnnotation, User}
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
import models.task.{Task, TaskService}
import org.bson.types.ObjectId
import scala.async.Async._
import braingames.geometry.Point3D

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 12:39
 */
object AnnotationService extends AnnotationFileService {
  def finishAnnotation(user: User, annotation: Annotation)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def tryToFinish(): Fox[(Annotation, String)] = {
      if (annotation.restrictions.allowFinish(user)) {
        if (annotation.state.isInProgress) {
          async {
            annotation match {
              case annotation if annotation._task.isEmpty =>
                Full(annotation.update(_.finish) -> Messages("annotation.finished"))
              case annotation =>
                val isTraining = await(annotation.isTrainingsAnnotation())
                val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
                if (isTraining)
                  Full(annotation.update(_.passToReview) -> Messages("task.passedToReview"))
                else if (isReadyToBeFinished)
                  Full(annotation.update(_.finish) -> Messages("task.finished"))
                else
                  Failure(Messages("tracing.notEnoughNodes"))
            }
          }
        } else
          Failure(Messages("annotation.notInProgress"))
      } else
        Failure(Messages("annotation.notPossible"))
    }

    tryToFinish().map {
      result =>
        AnnotationService.writeAnnotationToFile(annotation)
        UsedAnnotationDAO.removeAll(annotation.id)
        result
    }
  }

  def cancelTask(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
      _ <- TaskService.unassignOnce(task)
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield true
  }

  def freeAnnotationsOfUser(user: User)(implicit ctx: DBAccessContext) = {
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task).map { annotation =>
      cancelTask(annotation)
    }
    AnnotationDAO.unassignAnnotationsOfUser(new ObjectId(user._id.stringify))
  }

  def openExplorationalFor(user: User) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Explorational)

  def openTasksFor(user: User) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)

  def countOpenTasks(user: User) =
    AnnotationDAO.countOpenAnnotations(user._id, AnnotationType.Task)

  def hasAnOpenTask(user: User) =
    AnnotationDAO.hasAnOpenAnnotation(user._id, AnnotationType.Task)

  def findTasksOf(user: User) =
    AnnotationDAO.findFor(user, AnnotationType.Task)

  def findExploratoryOf(user: User) =
    AnnotationDAO.findForWithTypeOtherThan(user._id, AnnotationType.Task :: AnnotationType.SystemTracings)


  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      AnnotationDAO.copyDeepAndInsert(annotation.copy(
        _user = new ObjectId(user._id.stringify),
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task))

    for {
      annotationBase <- task.annotationBase.toFox
      _ <- TaskService.assignOnce(task)
      result <- useAsTemplateAndInsert(annotationBase)
    } yield {
      result
    }
  }

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, dataSetName: String, start: Point3D) = {
    val tracing = SkeletonTracing.createFrom(dataSetName, start, true, settings)
    val content = ContentReference.createFor(tracing)
    AnnotationDAO.insertOne(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
  }

  def createAnnotationBase(task: Task, userId: ObjectId, settings: AnnotationSettings, nml: NML) = {
    SkeletonTracing.createFrom(nml, settings).map {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insertOne(Annotation(userId, content, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }
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

  def loadAnnotationContent(annotation: Annotation) =
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