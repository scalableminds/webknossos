package models.graph

import play.api.libs.json.JsValue
import play.api.libs.json.Reads
import models.DataSet
import brainflight.tools.geometry.Point3D
import models.BasicDAO
import models.BranchPoint
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.Xml
import xml.XMLWrites
import Tree.TreeFormat
import play.api.libs.json.Reads
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import brainflight.tools.geometry.Scale
import models.Color

case class Experiment(dataSetName: String, trees: List[Tree], branchPoints: List[BranchPoint], time: Long, activeNodeId: Int, scale: Scale, editPosition: Point3D, _id: ObjectId = new ObjectId) {
  def id = _id.toString
  def tree(treeId: Int) = trees.find(_.id == treeId)
  def updateTree(tree: Tree) = this.copy(trees = tree :: trees.filter(_.id == tree.id))
}

object Experiment extends BasicDAO[Experiment]("experiments") {
  implicit object ExperimentXMLWrites extends XMLWrites[Experiment] {
    def writes(e: Experiment) = {
      (DataSet.findOneByName(e.dataSetName).map { dataSet =>
        <things>
          <parameters>
            <experiment name={ dataSet.name }/>
            <scale x={ e.scale.x.toString } y={ e.scale.y.toString } z={ e.scale.z.toString }/>
            <offset x="0" y="0" z="0"/>
            <time ms={ e.time.toString }/>
            <activeNode id={ e.activeNodeId.toString }/>
            <editPosition x={ e.editPosition.x.toString } y={ e.editPosition.y.toString } z={ e.editPosition.z.toString }/>
          </parameters>
          { e.trees.map(e => Xml.toXML(e)) }
          <comments>
            {
              for {
                tree <- e.trees
                node <- tree.nodes
                comment <- node.comment
              } yield {
                <comment node={ node.id.toString } content={ comment }/>
              }
            }
          </comments>
          <branchpoints>
            { e.branchPoints.map(BranchPoint.toXML) }
          </branchpoints>
        </things>
      }) getOrElse (<error>DataSet not fount</error>)
    }
  }

  def createNew = {
    val d = DataSet.default
    val tree = Tree(1, Nil, Nil, Color(1, 0, 0, 0))
    val exp = Experiment(d.name, List(tree), Nil, 0, 1, Scale(12, 12, 24), Point3D(0, 0, 0))
    Experiment.insert(exp)
    exp
  }

  implicit object ExperimentFormat extends Format[Experiment] {
    val ID = "id"
    val TREES = "trees"
    val ACTIVE_NODE = "activeNode"
    val BRANCH_POINTS = "branchPoints"
    val EDIT_POSITION = "editPosition"
    val SCALE = "scale"

    def writes(e: Experiment) = Json.obj(
      ID -> e.id,
      TREES -> e.trees.map(TreeFormat.writes),
      ACTIVE_NODE -> e.activeNodeId,
      BRANCH_POINTS -> e.branchPoints,
      SCALE -> e.scale,
      EDIT_POSITION -> e.editPosition)

    def reads(js: JsValue): Experiment = {

      val id = (js \ ID).as[String]
      val trees = (js \ TREES).as[List[Tree]]
      val activeNode = (js \ ACTIVE_NODE).as[Int]
      val branchPoints = (js \ BRANCH_POINTS).as[List[BranchPoint]]
      val editPosition = (js \ EDIT_POSITION).as[Point3D]
      Experiment.findOneById(id) match {
        case Some(exp) =>
          exp.copy(trees = trees, activeNodeId = activeNode, branchPoints = branchPoints, editPosition = editPosition)
        case _ =>
          throw new RuntimeException("Valid experiment id expected")
      }
    }
  }
}