package models.tracing.skeleton

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.annotation.{AnnotationSettings, AnnotationContent}
import play.api.libs.json.JsValue

case class TemporarySkeletonTracing(
    id: String,
    dataSetName: String,
    trees: List[TreeLike],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    settings: AnnotationSettings = AnnotationSettings.default.copy(isEditable = false)) extends SkeletonTracingLike with AnnotationContent{

  type Self = TemporarySkeletonTracing

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

object TemporarySkeletonTracing {
  def createFrom(nml: NML, id: String) = {
    TemporarySkeletonTracing(
      id,
      nml.dataSetName,
      nml.trees,
      nml.branchPoints,
      System.currentTimeMillis(),
      nml.activeNodeId,
      nml.editPosition,
      nml.comments)
  }
  
  def createFrom(tracing: SkeletonTracingLike, id: String) = {
    TemporarySkeletonTracing(
      id,
      tracing.dataSetName,
      tracing.trees,
      tracing.branchPoints,
      System.currentTimeMillis(),
      tracing.activeNodeId,
      tracing.editPosition,
      tracing.comments)
  }
}