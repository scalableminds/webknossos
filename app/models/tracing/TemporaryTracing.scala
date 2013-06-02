package models.tracing

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.user.User
import models.annotation.{AnnotationSettings, AnnotationContent}
import play.api.libs.json.JsValue

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
    settings: AnnotationSettings = AnnotationSettings.default.copy(isEditable = false)) extends TracingLike with AnnotationContent{

  type Self = TemporaryTracing

  def task = None

  def makeReadOnly =
    this.copy(settings = settings.copy(isEditable = false))
    
   def allowAllModes = 
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.ALL_MODES))
  
  def insertTree[TemporaryTracing](tree: TreeLike) = {
    this.copy(trees = tree :: trees).asInstanceOf[TemporaryTracing]
  }

  def insertBranchPoint[TemporaryTracing](bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[TemporaryTracing]

  def insertComment[TemporaryTracing](c: Comment) =
    this.copy(comments = c :: this.comments).asInstanceOf[TemporaryTracing]
  
  def updateFromJson(js: Seq[JsValue]) = ???

  def copyDeepAndInsert = ???

  def clearTracingData = ???
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