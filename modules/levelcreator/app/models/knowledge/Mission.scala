package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId
import com.mongodb.casbah.commons.MongoDBObject
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.novus.salat._
import models.context._
import scala.util.Random

case class Mission(dataSetName: String,
  start: MissionStart,
  errorCenter: Point3D,
  possibleEnds: List[PossibleEnd],
  _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission] {
  
  val dao = Mission
  lazy val id = _id.toString

  def withDataSetName(newDataSetName: String) = copy(dataSetName = newDataSetName)
}

object Mission extends BasicDAO[Mission]("missions") with CommonFormats with Function5[String, MissionStart, Point3D, List[PossibleEnd], ObjectId, Mission]{

  def createWithoutDataSet(start: MissionStart, errorCenter: Point3D, possibleEnds: List[PossibleEnd]) =
    Mission("", start, errorCenter, possibleEnds)

  def unapplyWithoutDataSet(m: Mission) = (m.start, m.errorCenter, m.possibleEnds)
  
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
  
  def deleteAllForDataSetExcept(dataSetName: String, missions: List[Mission]) = {
    val obsoleteMissions = findByDataSetName(dataSetName).filterNot(m => 
      missions.exists( mission => 
        m.start == mission.start &&
        m.errorCenter == mission.errorCenter
      ))
      
    removeByIds(obsoleteMissions.map(_._id))
    obsoleteMissions.map(_.id)
  }
  
  val PartialMissionReader: Reads[Mission] = (
    (__ \ "start").read[MissionStart] and
    (__ \ "errorCenter").read[Point3D] and
    (__ \ "possibleEnds").read[List[PossibleEnd]])(createWithoutDataSet _)
    
  implicit val missionFormat: Format[Mission] = Json.format[Mission]  
}