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

case class ContextFreeMission(uniqueId: Int, start: MissionStart, errorCenter: Point3D, possibleEnds: List[PossibleEnd]) {
  def addContext(dataSetName: String, batchId: Int) = Mission(dataSetName, uniqueId, batchId, start, errorCenter, possibleEnds)
}

object ContextFreeMission extends Function4[Int, MissionStart, Point3D, List[PossibleEnd], ContextFreeMission]{
  implicit val ContextFreeMissionReader: Reads[ContextFreeMission] = Json.reads[ContextFreeMission]  
}

case class Mission(dataSetName: String,
  uniqueId: Int,
  batchId: Int,
  start: MissionStart,
  errorCenter: Point3D,
  possibleEnds: List[PossibleEnd],
  _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission] {
  
  val key: String = start.toString
  
  val dao = Mission
  lazy val id = _id.toString

  def withDataSetName(newDataSetName: String) = copy(dataSetName = newDataSetName)
  
  def batchId(newBatchId: Int) = copy(batchId = newBatchId)
}

object Mission extends BasicDAO[Mission]("missions") with CommonFormats with Function7[String, Int, Int, MissionStart, Point3D, List[PossibleEnd], ObjectId, Mission]{

  def unapplyWithoutDataSetAndBatchId(m: Mission) = (m.uniqueId, m.start, m.errorCenter, m.possibleEnds)
  
  def findByDataSetName(dataSetName: String) = find(MongoDBObject("dataSetName" -> dataSetName)).toList
  
  def findOneByUniqueId(uniqueId: Int) = findOne(MongoDBObject("uniqueId" -> uniqueId))

  def randomByDataSetName(dataSetName: String) = {
    val missions = findByDataSetName(dataSetName)
    if (!missions.isEmpty)
      Some(missions(Random.nextInt(missions.size)))
    else None
  }

  def updateOrCreate(m: Mission) =
    findOne(MongoDBObject("dataSetName" -> m.dataSetName,
      "uniqueId" -> m.uniqueId)) match {
      case Some(stored) =>
        stored.update(_ => m.copy(_id = stored._id))
        stored._id
      case _ =>
        insertOne(m)
        m._id
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
  
    
  implicit val missionFormat: Format[Mission] = Json.format[Mission]  
}