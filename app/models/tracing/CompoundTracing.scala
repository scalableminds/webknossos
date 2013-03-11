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

case class TemporaryTracing(
    id: String,
    dataSetName: String,
    trees: List[TreeLike],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    tracingSettings: TracingSettings = TracingSettings.default.copy(isEditable = false),
    tracingType: TracingType.Value = TracingType.CompoundProject,
    version: Int = 0) extends TracingLike[TemporaryTracing] {

  def task = None

  def insertTree(tree: TreeLike): TemporaryTracing = {
    this.copy(trees = tree :: trees)
  }

  def insertBranchPoint(bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints)

  def insertComment(c: Comment) =
    this.copy(comments = c :: this.comments)
}

object TemporaryTracing {
  def createFrom(tracing: Tracing, id: String) = {
    TemporaryTracing(
      id,
      tracing.dataSetName,
      tracing.trees,
      tracing.branchPoints,
      System.currentTimeMillis(),
      tracing.activeNodeId,
      tracing.scale,
      tracing.editPosition,
      tracing.comments)
  }
}