package models.tracing

import oxalis.nml._
import oxalis.nml.utils._
import braingames.geometry.Scale
import braingames.geometry.Point3D
import play.api.libs.json.Json
import play.api.libs.json.Writes
import braingames.xml.XMLWrites
import models.binary.DataSet
import braingames.xml.Xml
import models.task.Task
import models.user.User

trait TracingLike extends ContainsTracingInfo{
  type Self <: TracingLike
  
  def self = this.asInstanceOf[Self]
  
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
  def state: TracingState

  def insertBranchPoint[A](bp: BranchPoint): A
  def insertComment[A](c: Comment): A
  def insertTree[A](tree: TreeLike): A
  
  def _name: Option[String] = None
  
  def user: Option[User] = None
  
  def makeReadOnly: Self

  def allowAllModes: Self
  
  def accessPermission(user: User): Boolean
  
  def isEditable = tracingSettings.isEditable
  
  
  private def applyUpdates(f: Self => Self*) = {
    f.foldLeft(self) {
      case (t, f) => f(t)
    }
  }

  private def updateWithAll[E](l: List[E])(f: (Self, E) => Self)(t: Self): Self = {
    l.foldLeft(t)(f)
  }

  def mergeWith(source: TracingLike): Self = {
    val (preparedTrees: List[TreeLike], nodeMapping: FunctionalNodeMapping) = prepareTreesForMerge(source.trees, trees)
    applyUpdates(
      updateWithAll(preparedTrees){
        case (tracing, tree) => tracing.insertTree(tree)
      },
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
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }
  }
}

object TracingLike {
  implicit object TracingLikeXMLWrites extends XMLWrites[TracingLike] {
    def writes(e: TracingLike) = {
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

  implicit object TracingLikeWrites extends Writes[TracingLike] {
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

    def writes(e: TracingLike) = Json.obj(
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