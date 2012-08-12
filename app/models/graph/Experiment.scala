package models.graph

import models.DataSet
import brainflight.tools.geometry.Point3D
import models.BasicDAO
import models.BranchPoint
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json.Writes
import play.api.libs.json.Json

case class Experiment(dataSetId: ObjectId, trees: List[Tree], branchPoints: List[BranchPoint], time: Long, activeNodeId: Int, editPosition: Point3D, _id: ObjectId = new ObjectId){
  def id = _id.toString
}

object Experiment extends BasicDAO[Experiment]("experiments") {
  def default = {
    (for {
      dataSet <- DataSet.findAll.headOption
      exp <- findOne(MongoDBObject("dataSetId" -> dataSet._id))
    } yield {
      exp
    }) getOrElse (throw new Exception("No Experiment found"))
  }
  
  implicit object ExperimentWrites extends Writes[Experiment]{
    def writes( e: Experiment) = Json.obj(
          "id" -> e.id,
          "trees" -> e.trees,
          "activeNode" -> e.activeNodeId,
          "branchPoints" -> e.branchPoints,
          "editPosition" -> e.editPosition ) 
  }
}