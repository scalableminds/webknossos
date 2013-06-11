package models.tracing.skeleton

import oxalis.nml._
import oxalis.nml.utils._
import braingames.geometry.Scale
import braingames.geometry.Point3D
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.xml.XMLWrites
import models.binary.DataSetDAO
import braingames.xml.Xml
import models.annotation.AnnotationContent
import models.annotation.AnnotationSettings
import play.api.i18n.Messages
import controllers.admin.NMLIO
import org.apache.commons.io.IOUtils
import models.basics.GlobalDBAccess
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

trait SkeletonTracingLike extends AnnotationContent {
  type Self <: SkeletonTracingLike

  def self = this.asInstanceOf[Self]

  def settings: AnnotationSettings

  def dataSetName: String

  def trees: List[TreeLike]

  def activeNodeId: Int

  def timestamp: Long

  def branchPoints: List[BranchPoint]

  def comments: List[Comment]

  def editPosition: Point3D

  def insertBranchPoint[A](bp: BranchPoint): A

  def insertComment[A](c: Comment): A

  def insertTree[A](tree: TreeLike): A

  def allowAllModes: Self

  def contentType = SkeletonTracing.contentType

  def downloadFileExtension = ".nml"

  def toDownloadStream =
    NMLIO.toXML(this).map(IOUtils.toInputStream)

  override def contentData =
    Some(SkeletonTracingLike.skeletonTracingLikeWrites.writes(this))

  private def applyUpdates(f: (Self => Self)*) = {
    f.foldLeft(self) {
      case (t, f) => f(t)
    }
  }

  private def updateWithAll[E](l: List[E])(f: (Self, E) => Self)(t: Self): Self = {
    l.foldLeft(t)(f)
  }

  def mergeWith(source: AnnotationContent): Self = {
    source match {
      case source: SkeletonTracingLike =>
        val (preparedTrees: List[TreeLike], nodeMapping: FunctionalNodeMapping) = prepareTreesForMerge(source.trees, trees)
        applyUpdates(
          updateWithAll(preparedTrees) {
            case (tracing, tree) => tracing.insertTree(tree)
          },
          updateWithAll(source.branchPoints) {
            case (tracing, branchPoint) => tracing.insertBranchPoint(branchPoint.copy(id = nodeMapping(branchPoint.id)))
          },
          updateWithAll(source.comments) {
            case (tracing, comment) => tracing.insertComment(comment.copy(node = nodeMapping(comment.node)))
          })
    }
  }

  private def prepareTreesForMerge(sourceTrees: List[TreeLike], targetTrees: List[TreeLike]): (List[TreeLike], FunctionalNodeMapping) = {
    val treeMaxId = maxTreeId(targetTrees)
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)

    def nodeMapping(nodeId: Int): Int = nodeId + nodeIdOffset
    val result = sourceTrees.map(tree =>
      tree.changeTreeId(tree.treeId + treeMaxId).applyNodeMapping(nodeMapping))

    result -> (nodeMapping _)
  }

  private def maxTreeId(trees: List[TreeLike]) = {
    if (trees.isEmpty)
      0
    else
      trees.map(_.treeId).max
  }

  private def calculateNodeOffset(sourceTrees: List[TreeLike], targetTrees: List[TreeLike]) = {
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }
  }
}

object SkeletonTracingLike {

  implicit object SkeletonTracingLikeXMLWrites extends XMLWrites[SkeletonTracingLike] with GlobalDBAccess {
    def writes(e: SkeletonTracingLike) = {
      for {
        dataSetOpt <- DataSetDAO.findOneByName(e.dataSetName)
        trees <- Xml.toXML(e.trees.filterNot(_.nodes.isEmpty))
        branchpoints <- Xml.toXML(e.branchPoints)
      } yield {
        dataSetOpt match {
          case Some(dataSet) =>
            <things>
              <parameters>
                <experiment name={dataSet.name}/>
                <scale x={dataSet.scale.x.toString} y={dataSet.scale.y.toString} z={dataSet.scale.z.toString}/>
                <offset x="0" y="0" z="0"/>
                <time ms={e.timestamp.toString}/>
                <activeNode id={e.activeNodeId.toString}/>
                <editPosition x={e.editPosition.x.toString} y={e.editPosition.y.toString} z={e.editPosition.z.toString}/>
              </parameters>
              {trees}
              <branchpoints>
                {branchpoints}
              </branchpoints>
              <comments>
                {e.comments.map(c => Xml.toXML(c))}
              </comments>
            </things>
          case _ =>
            <error>DataSet not fount</error>
        }
      }
    }
  }

  implicit val skeletonTracingLikeWrites: OWrites[SkeletonTracingLike] =
    ((__ \ 'trees).write[List[TreeLike]] and
      (__ \ 'activeNode).write[Int] and
      (__ \ 'branchPoints).write[List[BranchPoint]] and
      (__ \ 'comments).write[List[Comment]])(t =>
      (t.trees, t.activeNodeId, t.branchPoints, t.comments))
}