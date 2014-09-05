package models.tracing.skeleton

import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.geometry.Point3D
import oxalis.nml._
import oxalis.nml.utils._
import models.task.{TaskDAO, TaskType, Task, Project}
import play.api.Logger
import com.scalableminds.util.tools.TimeLogger._
import com.scalableminds.util.mvc.Formatter
import models.annotation._
import models.annotation.TemporaryAnnotation
import scala.{annotation, Some}
import models.annotation.Annotation
import models.annotation.AnnotationType._
import models.user.User

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import com.scalableminds.util.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import net.liftweb.common.{Empty, Failure, Full}

object CompoundAnnotation extends Formatter with FoxImplicits {

  def treePrefix(tracing: SkeletonTracingLike, user: Option[User], taskId: Option[BSONObjectID]) = {
    val userName = user.map(_.abreviatedName) getOrElse ""
    s"${formatHash(taskId.map(_.stringify).getOrElse(""))}_${userName}_"
  }

  def renameTreesOfTracing(tracing: SkeletonTracing, user: Option[User], taskId: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    def renameTrees(prefix: String, trees: List[TreeLike]) = {
      trees.zipWithIndex.map {
        case (tree, index) =>
          tree.changeName(s"${prefix}tree%03d".format(index + 1))
      }
    }
    TemporarySkeletonTracingService.createFrom(tracing, "").map{ temp =>
      temp.copy(
        _trees = renameTrees(treePrefix(tracing, user, taskId), temp._trees))
    }
  }

  def filterAnnotation(a: Annotation) =
    a.state.isFinished

  def createFromProject(project: Project)(implicit ctx: DBAccessContext) = {
    logTime("project composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten)
      } yield {
        createFromAnnotations(project.team, annotations, project.name, AnnotationType.CompoundProject)
      }
    }
  }

  def createFromTask(task: Task)(implicit ctx: DBAccessContext) = {
    logTime("task composition", Logger.debug) {
      for {
        annotations <- task.annotations
      } yield {
        createFromAnnotations(task.team, annotations, task.id, AnnotationType.CompoundTask)
      }
    }
  }

  def createFromTaskType(taskType: TaskType)(implicit ctx: DBAccessContext) = {
    logTime("taskType composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten)
      } yield {
        createFromAnnotations(taskType.team, annotations, taskType.id, AnnotationType.CompoundTaskType)
      }
    }
  }

  private[this] def annotationContent(annotations: List[Annotation], id: String)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    val annotationsWithContent: Future[List[(Annotation, AnnotationContent)]] =
      Fox.sequenceOfFulls(annotations.map(a => a.content.map(a -> _)))

    annotationsWithContent.flatMap( e => Fox.sequenceOfFulls(e.map{
      case (annotation, skeleton: SkeletonTracing) =>
        annotation.user.flatMap { user =>
          renameTreesOfTracing(skeleton, Some(user), annotation._task)
        } orElse (renameTreesOfTracing(skeleton, None, annotation._task))
      case (annotation, content) =>
        Fox.successful(content)
    })).toFox.flatMap {
      tracings =>
        createFromTracings(tracings, id)
    }
  }

  def createFromAnnotations(team: String, annotations: List[Annotation], id: String, typ: AnnotationType)(implicit ctx: DBAccessContext): Option[TemporaryAnnotation] = {
    val as = annotations.filter(filterAnnotation)

    as match {
      case head :: _ =>
        Some(TemporaryAnnotation(
          id,
          team,
          () => annotationContent(as, id),
          typ
        ))
      case _ =>
        None
    }
  }

  def createFromNotFinishedAnnotations(team: String, annotations: List[Annotation], id: String, typ: AnnotationType, restrictions: AnnotationRestrictions)(implicit ctx: DBAccessContext): Option[TemporaryAnnotation] = {
    Some(TemporaryAnnotation(
      id,
      team,
      () => annotationContent(annotations, id),
      typ,
      state = AnnotationState.InProgress,
      restrictions = restrictions
    ))
  }

  def createFromTracings(tracings: List[AnnotationContent], id: String)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    def mergeThem(tracings: List[AnnotationContent]): Fox[TemporarySkeletonTracing] = {
      tracings match {
        case head :: tail =>
          head match {
            case t: SkeletonTracingLike =>
              val base = TemporarySkeletonTracingService.createFrom(t, id)
              tail.foldLeft(base) {
                case (resultF, tracing) =>
                  resultF.flatMap(result => result.mergeWith(tracing))
              }
            case _ =>
              mergeThem(tail)
          }
        case _ =>
          Future.successful(None)
      }
    }
    mergeThem(tracings)
  }
}
