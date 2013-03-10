package models.tracing

import nml._
import nml.utils._
import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import play.api.libs.json.Json
import play.api.libs.json.Writes
import xml.XMLWrites
import models.binary.DataSet
import xml.Xml
import models.task.Task

trait TracingLike[T <: TracingLike[T]] { self: T =>
  def id: String
  def dataSetName: String
  def timestamp: Long
  def tracingSettings: TracingSettings
  def trees: List[TreeLike]
  def version: Int
  def activeNodeId: Int
  def branchPoints: List[BranchPoint]
  def scale: Scale
  def task: Option[Task]
  def comments: List[Comment]
  def tracingType: TracingType.Value
  def editPosition: Point3D

  def insertBranchPoint(bp: BranchPoint): T
  def insertComment(c: Comment): T
  def insertTree(tree: TreeLike): T

  private def applyUpdates(f: T => T*) = {
    f.foldLeft(this) {
      case (t, f) => f(t)
    }
  }

  private def updateWithAll[E](l: List[E])(f: (T, E) => T)(t: T): T = {
    l.foldLeft(t)(f)
  }

  def mergeWith(source: TracingLike[T]): T = {
    println("------- Starting merge -------")
    val (preparedTrees: List[TreeLike], nodeMapping: FunctionalNodeMapping) = prepareTreesForMerge(source.trees, trees)
    println("SourceComments: " + source.comments.size)
    println("TargetComments: " + comments.size)
    applyUpdates(
      updateWithAll(preparedTrees)(_.insertTree(_)),
      updateWithAll(source.branchPoints) {
        case (tracing, branchPoint) => tracing.insertBranchPoint(branchPoint.copy(id = nodeMapping(branchPoint.id)))
      },
      updateWithAll(source.comments) {
        case (tracing, comment) => tracing.insertComment(comment.copy(node = nodeMapping(comment.node)))
      })
  }

  private def prepareTreesForMerge(sourceTrees: List[TreeLike], targetTrees: List[TreeLike]): (List[TreeLike], FunctionalNodeMapping) = {
    val treeMaxId = maxTreeId(targetTrees)
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)
    println(s"Tree max id: $treeMaxId, Node offset: $nodeIdOffset")

    def nodeMapping(nodeId: Int) = nodeId + nodeIdOffset
    val result = sourceTrees.map(tree =>
      tree.changeTreeId(tree.treeId + treeMaxId).applyNodeMapping(nodeMapping))

    result -> nodeMapping
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
      val targetNodeMinId = minNodeId(targetTrees)
      val sourceNodeMaxId = maxNodeId(sourceTrees)
      println(s"Target min node: $targetNodeMinId. Source max node: $sourceNodeMaxId")
      math.max(sourceNodeMaxId + 1 - targetNodeMinId, 0)
    }
  }
}

object TracingLike {
  implicit object TracingLikeXMLWrites extends XMLWrites[TracingLike[_]] {
    def writes(e: TracingLike[_]) = {
      (DataSet.findOneByName(e.dataSetName).map { dataSet =>
        <things>
          <parameters>
            <experiment name={ dataSet.name }/>
            <scale x={ e.scale.x.toString } y={ e.scale.y.toString } z={ e.scale.z.toString }/>
            <offset x="0" y="0" z="0"/>
            <time ms={ e.timestamp.toString }/>
            <activeNode id={ e.activeNodeId.toString }/>
            <editPosition x={ e.editPosition.x.toString } y={ e.editPosition.y.toString } z={ e.editPosition.z.toString }/>
          </parameters>
          { e.trees.filterNot(_.nodes.isEmpty).map(t => Xml.toXML(t)) }
          <branchpoints>
            { e.branchPoints.map(b => Xml.toXML(b)) }
          </branchpoints>
          <comments>
            { e.comments.map(c => Xml.toXML(c)) }
          </comments>
        </things>
      }) getOrElse (<error>DataSet not fount</error>)
    }
  }

  implicit object TracingLikeWrites extends Writes[TracingLike[_]] {
    val ID = "id"
    val VERSION = "version"
    val TREES = "trees"
    val ACTIVE_NODE = "activeNode"
    val BRANCH_POINTS = "branchPoints"
    val EDIT_POSITION = "editPosition"
    val SCALE = "scale"
    val COMMENTS = "comments"
    val TRACING_TYPE = "tracingType"
    val SETTINGS = "settings"

    def writes(e: TracingLike[_]) = Json.obj(
      ID -> e.id,
      SETTINGS -> e.tracingSettings,
      TREES -> e.trees,
      VERSION -> e.version,
      ACTIVE_NODE -> e.activeNodeId,
      BRANCH_POINTS -> e.branchPoints,
      SCALE -> e.scale,
      COMMENTS -> e.comments,
      EDIT_POSITION -> e.editPosition,
      TRACING_TYPE -> e.tracingType.toString)
  }
}