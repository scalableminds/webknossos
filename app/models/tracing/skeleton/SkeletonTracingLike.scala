package models.tracing.skeleton

import oxalis.nml._
import oxalis.nml.utils._
import braingames.geometry.Scale
import braingames.geometry.{Point3D, BoundingBox}
import play.api.libs.json._
import play.api.libs.functional.syntax._
import braingames.xml.XMLWrites
import models.binary.DataSetDAO
import braingames.xml.Xml
import models.annotation.{AnnotationType, ContentReference, AnnotationContent, AnnotationSettings}
import play.api.i18n.Messages
import controllers.admin.NMLIO
import org.apache.commons.io.IOUtils
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

import models.annotation.AnnotationType._
import scala.Some
import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType
import braingames.reactivemongo.GlobalDBAccess
import braingames.util.{FoxImplicits, Fox}
import net.liftweb.common.Full
import java.io.InputStream

trait SkeletonTracingLike extends AnnotationContent {
  type Self <: SkeletonTracingLike

  def self = this.asInstanceOf[Self]

  def settings: AnnotationSettings

  def dataSetName: String

  def trees: Fox[List[TreeLike]]

  def activeNodeId: Option[Int]

  def timestamp: Long

  def branchPoints: List[BranchPoint]

  def comments: List[Comment]

  def editPosition: Point3D

  def zoomLevel: Double

  def boundingBox: Option[BoundingBox]

  def insertBranchPoint[T](bp: BranchPoint): Fox[T]

  def insertComment[T](c: Comment): Fox[T]

  def insertTree[T](tree: TreeLike): Fox[T]

  def allowAllModes: Self

  def contentType = SkeletonTracing.contentType

  def downloadFileExtension = ".nml"

  def toDownloadStream: Fox[InputStream] =
    NMLService.toNML(this).map(IOUtils.toInputStream)

  override def contentData =
    SkeletonTracingLike.skeletonTracingLikeWrites(this)

  private def applyUpdates(f: (Self => Fox[Self])*) = {
    f.foldLeft(Fox.successful(self)) {
      case (futureT, f) => futureT.flatMap(t => f(t))
    }
  }

  private def updateWithAll[E](list: List[E])(f: (Self, E) => Fox[Self])(start: Self): Fox[Self] = {
    list.foldLeft(Fox.successful(start)) {
      case (fs, e) => fs.flatMap(s => f(s, e))
    }
  }

  def mergeWith(source: AnnotationContent): Fox[Self] = {
    source match {
      case source: SkeletonTracingLike =>
        for {
          sourceTrees <- source.trees
          targetTrees <- trees
          (preparedTrees: List[TreeLike], nodeMapping: FunctionalNodeMapping) = prepareTreesForMerge(sourceTrees, targetTrees)
          result <- applyUpdates(
            updateWithAll(preparedTrees){
              case (tracing, tree) => tracing.insertTree(tree)
            },
            updateWithAll(source.branchPoints) {
              case (tracing, branchPoint) => tracing.insertBranchPoint(branchPoint.copy(id = nodeMapping(branchPoint.id)))
            },
            updateWithAll(source.comments) {
              case (tracing, comment) => tracing.insertComment(comment.copy(node = nodeMapping(comment.node)))
            })
        } yield result
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

object SkeletonTracingLike extends FoxImplicits {

  implicit object SkeletonTracingLikeXMLWrites extends XMLWrites[SkeletonTracingLike] with GlobalDBAccess {
    def writes(e: SkeletonTracingLike): Fox[scala.xml.Node] = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(e.dataSetName)
        dataSource <- dataSet.dataSource.toFox
        trees <- e.trees
        treesXml <- Xml.toXML(trees.filterNot(_.nodes.isEmpty))
        branchpoints <- Xml.toXML(e.branchPoints)
        comments <- Xml.toXML(e.comments)
      } yield {
        <things>
          <parameters>
            <experiment name={dataSet.name}/>
            <scale x={dataSource.scale.x.toString} y={dataSource.scale.y.toString} z={dataSource.scale.z.toString}/>
            <offset x="0" y="0" z="0"/>
            <time ms={e.timestamp.toString}/>
            {e.activeNodeId.map(id => scala.xml.XML.loadString(s"""<activeNode id="$id"/>""")).getOrElse(scala.xml.Null)}
            <editPosition x={e.editPosition.x.toString} y={e.editPosition.y.toString} z={e.editPosition.z.toString}/>
            <zoomLevel zoom={e.zoomLevel.toString}/>
          </parameters>{treesXml}<branchpoints>
          {branchpoints}
        </branchpoints>
          <comments>
            {comments}
          </comments>
        </things>
      }
    }
  }

  def skeletonTracingLikeWrites(t: SkeletonTracingLike) =
    for {
      trees <- t.trees
    } yield {
      Json.obj(
        "activeNode" -> t.activeNodeId,
        "branchPoints" -> t.branchPoints,
        "comments" -> t.comments,
        "trees" -> trees,
        "zoomLevel" -> t.zoomLevel
      )
    }
}
