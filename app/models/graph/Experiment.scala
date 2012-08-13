package models.graph

import models.DataSet
import brainflight.tools.geometry.Point3D
import models.BasicDAO
import models.BranchPoint
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json.Writes
import play.api.libs.json.Json

case class Experiment(dataSetId: ObjectId, trees: List[Tree], branchPoints: List[BranchPoint], time: Long, activeNodeId: Int, editPosition: Point3D, _id: ObjectId = new ObjectId) {
  def id = _id.toString
  def tree(treeId: Int) = trees.find( _.id == treeId)
  def updateTree( tree: Tree) = this.copy( trees = tree :: trees.filter( _.id == tree.id))
}

object Experiment extends BasicDAO[Experiment]("experiments") {
  def toXML(e: Experiment) = {
    (DataSet.findOneById(e.dataSetId).map { dataSet =>
      <things>
        <parameters>
          <experiment name={ dataSet.name }/>
          <scale x="12.0" y="12.0" z="24.0"/>
          <offset x="0" y="0" z="0"/>
          <time ms={ e.time.toString }/>
          <activeNode id={ e.activeNodeId.toString }/>
          <editPosition x={ e.editPosition.x.toString } y={ e.editPosition.y.toString } z={ e.editPosition.z.toString }/>
        </parameters>
        { e.trees.map(Tree.toXML) }
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

  def default = {
    (for {
      dataSet <- DataSet.findAll.headOption
      exp <- findOne(MongoDBObject("dataSetId" -> dataSet._id))
    } yield {
      exp
    }) getOrElse (throw new Exception("No Experiment found"))
  }

  implicit object ExperimentWrites extends Writes[Experiment] {
    def writes(e: Experiment) = Json.obj(
      "id" -> e.id,
      "trees" -> e.trees,
      "activeNode" -> e.activeNodeId,
      "branchPoints" -> e.branchPoints,
      "editPosition" -> e.editPosition)
  }
}