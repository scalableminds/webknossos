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

  def createFromTracings(tracings: List[Tracing], id: String): Option[TemporaryTracing] = {
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
    val t = System.currentTimeMillis()
    val r = mergeThem(tracings.sliding(50, 50).toSeq.par.flatMap(mergeThem).toList)
    Logger.debug(s"Merging took: ${System.currentTimeMillis() - t} ms")
    r
  }
}