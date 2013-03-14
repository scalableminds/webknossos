package models.tracing

import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import nml._
import nml.utils._
import models.task._
import play.api.Logger

object CompoundTracing {

  def createFromProject(project: Project) = {
    createFromTracings(Task
      .findAllByProject(project.name)
      .flatMap(_.tracings.filter(_.state.isFinished)), project.name)
      .map(_.copy(tracingType = TracingType.CompoundProject))
  }

  def createFromTask(task: Task) = {
    createFromTracings(task.tracings.filter(_.state.isFinished), task.id)
      .map(_.copy(tracingType = TracingType.CompoundTask))
  }

  def createFromTaskType(taskType: TaskType) = {
    createFromTracings(Task.findAllByTaskType(taskType)
      .flatMap(_.tracings.filter(_.state.isFinished)), taskType.id)
      .map(_.copy(tracingType = TracingType.CompoundTaskType))
  }

  def createFromTracings(tracings: List[Tracing], id: String): Option[TemporaryTracing] = {
    val t = System.currentTimeMillis()
    val r = tracings match {
      case head :: tail =>
        val base = TemporaryTracing.createFrom(head, id)
        def createFromTracingsSmall(tracings: List[Tracing]): TemporaryTracing = {
          tracings.foldLeft(base) {
            case (result, tracing) =>
              result.mergeWith(tracing)
          }
        }
        Some(tracings.sliding(50, 50).toList.par.map(createFromTracingsSmall).foldLeft(base) {
          case (result, tracing) =>
            result.mergeWith(tracing)
        })
      case _ =>
        None
    }
    Logger.debug(s"Merging took: ${System.currentTimeMillis() - t} ms")
    r
  }
}