package models.tracing

import nml.TreeLike
import nml.BranchPoint
import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import nml.Comment

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
    version: Int = 0) extends TracingLike {

  type Self = TemporaryTracing

  def task = None
  
  def isReadOnly = true

  def insertTree[TemporaryTracing](tree: TreeLike) = {
    this.copy(trees = tree :: trees).asInstanceOf[TemporaryTracing]
  }

  def insertBranchPoint[TemporaryTracing](bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[TemporaryTracing]

  def insertComment[TemporaryTracing](c: Comment) =
    this.copy(comments = c :: this.comments).asInstanceOf[TemporaryTracing]
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