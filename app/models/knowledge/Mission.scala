package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId
import com.mongodb.casbah.commons.MongoDBObject
import play.api.libs.json._
import com.novus.salat._
import models.context._
import scala.util.Random

case class Mission(dataSetName: String,
  start: MissionStart,
  possibleEnds: List[PossibleEnd],
  _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission] {
  
  val dao = Mission
  lazy val id = _id.toString

  def withDataSetName(newDataSetName: String) = copy(dataSetName = newDataSetName)
}

object Mission extends BasicKnowledgeDAO[Mission]("missions") {

  def createWithoutDataSet(start: MissionStart, possibleEnds: List[PossibleEnd]) =
    Mission("", start, possibleEnds)

  def findByDataSetName(dataSetName: String) = find(MongoDBObject("dataSetName" -> dataSetName)).toList

  def randomByDataSetName(dataSetName: String) = {
    val missions = findByDataSetName(dataSetName)
    if (!missions.isEmpty)
      Some(missions(Random.nextInt(missions.size)))
    else None
  }

  def updateOrCreate(m: Mission) =
    findOne(MongoDBObject("dataSetName" -> m.dataSetName,
      "start" -> grater[MissionStart].asDBObject(m.start))) match {
      case Some(stored) =>
        stored.update(_ => m.copy(_id = stored._id))
      case _ =>
        insertOne(m)
    }

  implicit object MissionReads extends Format[Mission] {
    val START = "start"
    val POSSIBLE_ENDS = "possibleEnds"

    def reads(js: JsValue) =
      JsSuccess(Mission.createWithoutDataSet((js \ START).as[MissionStart],
        (js \ POSSIBLE_ENDS).as[List[PossibleEnd]]))

    def writes(mission: Mission) = Json.obj(
      START -> mission.start,
      POSSIBLE_ENDS -> Json.toJson(mission.possibleEnds))
  }
}