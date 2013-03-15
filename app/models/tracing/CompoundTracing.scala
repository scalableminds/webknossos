package models.tracing

import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import nml._
import nml.utils._
import models.task._
import play.api.Logger
import braingames.util.TimeLogger._
import brainflight.format.Formatter

object CompoundTracing extends Formatter {

  def renameTrees(prefix: String, trees: List[TreeLike]) = {
    trees.zipWithIndex.map {
      case (tree, index) =>
        tree.changeName(s"${prefix}tree%03d".format(index + 1))
    }
  }

  def treePrefix(tracing: TracingLike) = {
    val userName = tracing.user.map(_.abreviatedName) getOrElse ""
    val taskId = tracing.task.map(t => formatHash(t.id)) getOrElse ""
    s"${taskId}_${userName}_"
  }

  def createFromProject(project: Project) = {
    logTime("project composition") {
      createFromTracings(Task
        .findAllByProject(project.name)
        .flatMap(_.tracings.filter(_.state.isFinished).par.map { tracing =>
          val temp = TemporaryTracing.createFrom(tracing, "")
          temp.copy(
            trees = renameTrees(treePrefix(tracing), temp.trees))
        }), project.name)
        .map(_.copy(tracingType = TracingType.CompoundProject))
    }
  }

  def createFromTask(task: Task) = {
    val id = task.id
    createFromTracings(task.tracings.filter(_.state.isFinished), id)
      .orElse(createFromTracings(task.tracingBase.toList, id))
      .map(_.copy(tracingType = TracingType.CompoundTask))
  }

  def createFromTaskType(taskType: TaskType) = {
    createFromTracings(Task.findAllByTaskType(taskType)
      .flatMap(_.tracings.filter(_.state.isFinished)), taskType.id)
      .map(_.copy(tracingType = TracingType.CompoundTaskType))
  }

  def createFromTracings(tracings: List[TracingLike], id: String): Option[TemporaryTracing] = {
    def mergeThem(tracings: List[TracingLike]) = {
      tracings match {
        case head :: tail =>
          val base = TemporaryTracing.createFrom(head, id)
          Some(tail.foldLeft(base) {
            case (result, tracing) =>
              result.mergeWith(tracing)
          })
        case _ =>
          None
      }
    }
    mergeThem(tracings.sliding(50, 50).toSeq.par.flatMap(mergeThem).toList)
  }
}