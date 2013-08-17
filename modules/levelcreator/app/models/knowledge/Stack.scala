package models.knowledge

import java.io.File
import braingames.util.FileRegExFilter
import play.api.libs.json.Json
import play.api.libs.json._
import org.bson.types.ObjectId
import reactivemongo.bson.BSONObjectID
import MissionDAO.{formatter => levelFormat}
import LevelDAO.{formatter => missionFormat}
import play.modules.reactivemongo.json.BSONFormats._


case class Stack(level: Level, mission: Mission, _id: BSONObjectID = BSONObjectID.generate){
  val id = _id.toString
  
  val path = s"${level.stackFolder}/${mission.id}"
  val directory = new File(path)
  val tarFile = new File(s"$path/stack.tar")
  val metaFile = new File(s"$path/meta.json")
  val xmlAtlas = new File(s"$path/atlas.xml")

  def isTared = tarFile.exists
  def isProduced = directory.exists && metaFile.exists
  def frames = directory.listFiles(Stack.stackFrameFileFilter).toList.sortBy(_.getName)
}

object Stack{
  implicit val stackFormat = Json.format[Stack]
  
  val stackFrameRegEx = """stackImage[0-9]+\.png""".r
  val stackFrameFileFilter = new FileRegExFilter(stackFrameRegEx)
}