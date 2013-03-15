package models.tracing

import nml.TreeLike
import nml.BranchPoint
import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import nml.Comment
import nml.NML

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
  
  def makeReadOnly = 
    this.copy(tracingSettings = tracingSettings.copy(isEditable = false))
  
  def insertTree[TemporaryTracing](tree: TreeLike) = {
    this.copy(trees = tree :: trees).asInstanceOf[TemporaryTracing]
  }

  def insertBranchPoint[TemporaryTracing](bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[TemporaryTracing]

  def insertComment[TemporaryTracing](c: Comment) =
    this.copy(comments = c :: this.comments).asInstanceOf[TemporaryTracing]
}

object TemporaryTracing {
  def createFrom(nml: NML, id: String) = {
    TemporaryTracing(
      id,
      nml.dataSetName,
      nml.trees,
      nml.branchPoints,
      System.currentTimeMillis(),
      nml.activeNodeId,
      nml.scale,
      nml.editPosition,
      nml.comments)
  }
  
  def createFrom(tracing: TracingLike, id: String) = {
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