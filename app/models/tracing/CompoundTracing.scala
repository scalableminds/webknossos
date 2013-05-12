package models.tracing

import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml._
import oxalis.nml.utils._
import models.task._
import play.api.Logger
import braingames.util.TimeLogger._
import braingames.format.Formatter

object CompoundTracing extends Formatter {

  def treePrefix(tracing: TracingLike) = {
    val userName = tracing.user.map(_.abreviatedName) getOrElse ""
    val taskId = tracing.task.map(t => formatHash(t.id)) getOrElse ""
    s"${taskId}_${userName}_"
  }

  def renameTreesOfTracing(tracing: Tracing) = {
    def renameTrees(prefix: String, trees: List[TreeLike]) = {
      trees.zipWithIndex.map {
        case (tree, index) =>
          tree.changeName(s"${prefix}tree%03d".format(index + 1))
      }
    }
    val temp = TemporaryTracing.createFrom(tracing, "")
    temp.copy(
      trees = renameTrees(treePrefix(tracing), temp.trees))
  }

  def createFromProject(project: Project) = {
    logTime("project composition", Logger.debug) {
      createFromTracings(Task
        .findAllByProject(project.name)
        .flatMap(_.tracings.filter(_.state.isFinished).par.map(renameTreesOfTracing)), project.name)
        .map(_.copy(tracingType = TracingType.CompoundProject))
    }
  }

  def createFromTask(task: Task) = {
    logTime("task composition", Logger.debug) {
      createFromTracings(task.tracings.filter(_.state.isFinished).map(renameTreesOfTracing), task.id)
        .orElse(createFromTracings(task.tracingBase.toList, task.id))
        .map(_.copy(tracingType = TracingType.CompoundTask))
    }
  }

  def createFromTaskType(taskType: TaskType) = {
    logTime("taskType composition", Logger.debug) {
      createFromTracings(Task.findAllByTaskType(taskType)
        .flatMap(_.tracings.filter(_.state.isFinished).par.map(renameTreesOfTracing)), taskType.id)
        .map(_.copy(tracingType = TracingType.CompoundTaskType))
    }
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