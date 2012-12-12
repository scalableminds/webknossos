package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId
import play.api.libs.json.Format
import play.api.libs.json.JsValue
import play.api.libs.json.Reads

case class Mission(dataSetName: String, start: MissionStart, possibleEnds: List[PossibleEnd], _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission] {
  val dao = Mission
}

object Mission extends BasicKnowledgeDAO[Mission]("mission") {

  def createWithoutDataSet(start: MissionStart, possibleEnds: List[PossibleEnd]) =
    Mission("", start, possibleEnds)

  implicit object MissionReads extends Reads[Mission] {
    val START = "start"
    val POSSIBLE_ENDS = "possibleEnds"

    def reads(js: JsValue) =
      Mission.createWithoutDataSet((js \ START).as[MissionStart],
        (js \ POSSIBLE_ENDS).as[List[PossibleEnd]])
  }
}