package models.tracing.skeleton

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.annotation.{AnnotationType, ContentReference, AnnotationSettings, AnnotationContent}
import play.api.libs.json.JsValue
import org.bson.types.ObjectId
import models.annotation.AnnotationType._
import scala.Some
import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType

case class TemporarySkeletonTracing(
  id: String,
  dataSetName: String,
  trees: List[TreeLike],
  branchPoints: List[BranchPoint],
  timestamp: Long,
  activeNodeId: Int,
  editPosition: Point3D,
  comments: List[Comment] = Nil,
  settings: AnnotationSettings = AnnotationSettings.default) extends SkeletonTracingLike with AnnotationContent {

  type Self = TemporarySkeletonTracing

  def task = None

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
  def createFrom(nml: NML, id: String, settings: AnnotationSettings = AnnotationSettings.default) = {
    TemporarySkeletonTracing(
      id,
      nml.dataSetName,
      nml.trees,
      nml.branchPoints,
      System.currentTimeMillis(),
      nml.activeNodeId,
      nml.editPosition,
      nml.comments,
      settings)
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

  def createFrom(nmls: List[NML], settings: AnnotationSettings): Option[TemporarySkeletonTracing] = {
    nmls match {
      case head :: tail =>
        val startTracing = createFrom(head, "", settings)

        Some(tail.foldLeft(startTracing) {
          case (t, s) =>
            t.mergeWith(TemporarySkeletonTracing.createFrom(s, s.timestamp.toString))
        })
      case _ =>
        None
    }
  }
}