package models.annotation

import models.user.User
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.Logger
import play.api.libs.json.Json
import scala.collection.mutable.ListBuffer
import scala.concurrent.Future
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import models.tracing.skeleton.SkeletonTracingService
import play.api.libs.concurrent.Execution.Implicits._
import models.task.{Task, TaskService}
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationType._
import scala.Some
import models.binary.DataSet
import oxalis.nml.NML
import com.scalableminds.util.mvc.BoxImplicits
import play.modules.reactivemongo.json.BSONFormats._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 12:39
 */

object AnnotationService extends AnnotationContentProviders with BoxImplicits with FoxImplicits {

  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String, id: String = "")(implicit ctx: DBAccessContext) =
    withProviderForContentType(contentType) { provider =>
      for {
        content <- provider.createFrom(dataSet).toFox
        contentReference = ContentReference.createFor(content)
        annotation = Annotation(
          Some(user._id),
          contentReference,
          team = user.teams.head.team, // TODO: refactor
          typ = AnnotationType.Explorational,
          state = AnnotationState.InProgress,
          _id = BSONObjectID.parse(id).getOrElse(BSONObjectID.generate)
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

  def findFinishedOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFinishedFor(user._id)


  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      annotation.copy(
        _user = Some(user._id),
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task).temporaryDuplicate(keepId = false).flatMap(_.saveToDB)

    for {
      annotationBase <- task.annotationBase
      _ <- TaskService.assignOnce(task).toFox
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, boundingBox: BoundingBox, settings: AnnotationSettings, dataSetName: String, start: Point3D)(implicit ctx: DBAccessContext) = {
    for {
      tracing <- SkeletonTracingService.createFrom(dataSetName, start, Some(boundingBox), insertStartAsNode = true, settings)
      content = ContentReference.createFor(tracing)
      _ <- AnnotationDAO.insert(Annotation(Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    } yield tracing
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, boundingBox: BoundingBox, settings: AnnotationSettings, nml: NML)(implicit ctx: DBAccessContext) = {
    SkeletonTracingService.createFrom(nml, Some(boundingBox), settings).toFox.flatMap {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insert(Annotation(Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }
  }

  def createFrom(_user: BSONObjectID, team: String, content: AnnotationContent, annotationType: AnnotationType, name: Option[String])(implicit ctx: DBAccessContext) = {
    val annotation = Annotation(
      Some(_user),
      ContentReference.createFor(content),
      team = team,
      _name = name,
      typ = annotationType)

    AnnotationDAO.insert(annotation).map { _ =>
      annotation
    }
  }

  def createFrom(temporary: TemporaryAnnotation, content: AnnotationContent, id: BSONObjectID)(implicit ctx: DBAccessContext) = {
    val annotation = Annotation(
      temporary._user,
      ContentReference.createFor(content),
      temporary._task,
      temporary.team,
      temporary.state,
      temporary.typ,
      temporary.version,
      temporary._name,
      temporary.created,
      id)

    saveToDB(annotation)
  }

  def merge(readOnly: Boolean, _user: BSONObjectID, team: String, typ: AnnotationType, annotationsLike: AnnotationLike*)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    val restrictions =
      if (readOnly)
        AnnotationRestrictions.readonlyAnnotation()
      else
        AnnotationRestrictions.updateableAnnotation()

    CompoundAnnotation.createFromAnnotations(BSONObjectID.generate.stringify, Some(_user), team, None, annotationsLike.toList, typ, AnnotationState.InProgress, restrictions)
  }

  def saveToDB(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    AnnotationDAO.update(
      Json.obj("_id" -> annotation._id),
      Json.obj(
        "$set" -> AnnotationDAO.formatWithoutId(annotation),
        "$setOnInsert" -> Json.obj("_id" -> annotation._id)
      ),
      upsert = true).map { _ =>
      annotation
    }
  }
}

