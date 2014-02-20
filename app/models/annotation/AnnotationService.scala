package models.annotation

import models.user.User
import braingames.reactivemongo.DBAccessContext
import scala.concurrent.Future
import braingames.util.{FoxImplicits, Fox}
import models.tracing.skeleton.{SkeletonTracingService}
import play.api.libs.concurrent.Execution.Implicits._
import models.task.{Task, TaskService}
import braingames.geometry.Point3D
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationType._
import scala.Some
import models.binary.DataSet
import oxalis.nml.NML
import braingames.mvc.BoxImplicits

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 12:39
 */

object AnnotationService extends AnnotationContentProviders with BoxImplicits with FoxImplicits{
  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String)(implicit ctx: DBAccessContext) =
    withProviderForContentType(contentType) { provider =>
      for {
        content <- provider.createFrom(dataSet).toFox
        contentReference = ContentReference.createFor(content)
        annotation = Annotation(
          user._id,
          contentReference,
          team = user.teams.head.team, // TODO: refactor
          typ = AnnotationType.Explorational,
          state = AnnotationState.InProgress
        )
        _ <- AnnotationDAO.insert(annotation)
      } yield annotation
    }

  def baseFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.TracingBase).one[Annotation].toFox

  def annotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.Task).cursor[Annotation].collect[List]()

  def freeAnnotationsOfUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      annotations <- AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)
      _ = annotations.map(annotation => annotation.muta.cancelTask())
      result <- AnnotationDAO.unassignAnnotationsOfUser(user._id)
    } yield result
  }

  def openExplorationalFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Explorational)

  def openTasksFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)

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
      annotation.copy(
        _user = user._id,
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task).muta.copyDeepAndInsert()

    for {
      annotationBase <- task.annotationBase
      _ <- TaskService.assignOnce(task).toFox
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, settings: AnnotationSettings, dataSetName: String, start: Point3D)(implicit ctx: DBAccessContext) = {
    for {
      tracing <- SkeletonTracingService.createFrom(dataSetName, start, true, settings)
      content = ContentReference.createFor(tracing)
      _ <- AnnotationDAO.insert(Annotation(userId, content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    } yield tracing
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, settings: AnnotationSettings, nml: NML)(implicit ctx: DBAccessContext) = {
    SkeletonTracingService.createFrom(nml, settings).toFox.map {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insert(Annotation(userId, content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }
  }

  def createSample(annotation: Annotation, _task: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    annotation.copy(
      typ = AnnotationType.Sample,
      _task = Some(_task)).muta.copyDeepAndInsert()
  }

  def createFrom(_user: BSONObjectID, team: String, content: AnnotationContent, annotationType: AnnotationType, name: Option[String])(implicit ctx: DBAccessContext) = {
    val annotation = Annotation(
      _user,
      ContentReference.createFor(content),
      team = team,
      _name = name,
      typ = annotationType)

    AnnotationDAO.insert(annotation).map { _ =>
      annotation
    }
  }
}

