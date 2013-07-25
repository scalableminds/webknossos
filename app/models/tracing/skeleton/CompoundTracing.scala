package models.tracing.skeleton

import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml._
import oxalis.nml.utils._
import models.task.{TaskType, Task, Project}
import play.api.Logger
import braingames.util.TimeLogger._
import braingames.format.Formatter
import models.annotation._
import models.annotation.TemporaryAnnotation
import scala.Some
import models.annotation.Annotation
import models.annotation.AnnotationType._
import models.user.User
import org.bson.types.ObjectId


object CompoundAnnotation extends Formatter {

  def treePrefix(tracing: SkeletonTracingLike, user: Option[User], taskId: Option[ObjectId]) = {
    val userName = user.map(_.abreviatedName) getOrElse ""
    s"${formatHash(taskId.map(_.toString).getOrElse(""))}_${userName}_"
  }

  def renameTreesOfTracing(tracing: SkeletonTracing, user: Option[User], taskId: Option[ObjectId]) = {
    def renameTrees(prefix: String, trees: List[TreeLike]) = {
      trees.zipWithIndex.map {
        case (tree, index) =>
          tree.changeName(s"${prefix}tree%03d".format(index + 1))
      }
    }
    val temp = TemporarySkeletonTracing.createFrom(tracing, "")
    temp.copy(
      trees = renameTrees(treePrefix(tracing, user, taskId), temp.trees))
  }

  def filterAnnotation(a: Annotation) =
    a.state.isFinished

  def createFromProject(project: Project) = {
    logTime("project composition", Logger.debug) {
      createFromAnnotations(Task
        .findAllByProject(project.name)
        .flatMap(_.annotations), project.name, AnnotationType.CompoundProject)
    }
  }

  def createFromTask(task: Task) = {
    logTime("task composition", Logger.debug) {
      createFromAnnotations(
        task.annotations, task.id, AnnotationType.CompoundTask)
    }
  }

  def createFromTaskType(taskType: TaskType) = {
    logTime("taskType composition", Logger.debug) {
      createFromAnnotations(Task.findAllByTaskType(taskType)
        .flatMap(_.annotations), taskType.id, AnnotationType.CompoundTaskType)
    }
  }

  def createFromAnnotations(annotations: List[Annotation], id: String, typ: AnnotationType): Option[TemporaryAnnotation] = {
    val as = annotations.filter(filterAnnotation)

    def createContent() = {
      lazy val ts: List[AnnotationContent] = as.flatMap(annotation => annotation.content.map {
        case t: SkeletonTracing =>
          renameTreesOfTracing(t, annotation.user, annotation._task)
        case e =>
          e

      })
      createFromTracings(ts, id)
    }

    as match {
      case head :: _ =>
        Some(TemporaryAnnotation(
          id,
          createContent,
          typ
        ))
      case _ =>
        None
    }
  }

  def createFromTracings(tracings: List[AnnotationContent], id: String): Option[TemporarySkeletonTracing] = {
    def mergeThem(tracings: List[AnnotationContent]): Option[TemporarySkeletonTracing] = {
      tracings match {
        case head :: tail =>
          head match {
            case t: SkeletonTracing =>
              val base = TemporarySkeletonTracing.createFrom(t, id)
              Some(tail.foldLeft(base) {
                case (result, tracing) =>
                  result.mergeWith(tracing)
              })
            case _ =>
              mergeThem(tail)
          }
        case _ =>
          None
      }
    }
    mergeThem(tracings.sliding(50, 50).toSeq.par.flatMap(mergeThem).toList)
  }
}