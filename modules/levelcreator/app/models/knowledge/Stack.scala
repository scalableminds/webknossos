package models.knowledge

import java.io.File
import braingames.util.FileRegExFilter
import play.api.libs.json.Json
import play.api.libs.json._
import org.bson.types.ObjectId


case class Stack(level: Level, mission: Mission, _id: ObjectId = new ObjectId){
  val id = _id.toString
  
  val path = s"${level.stackFolder}/${mission.id}"
  val directory = new File(path)
  val tarFile = new File(s"$path/stack.tar")
  val metaFile = new File(s"$path/meta.json")
  val image = new File(s"$path/stack.png")
  
  def isTared = tarFile.exists
  def isProduced = directory.exists && metaFile.exists
  def frames = directory.listFiles(Stack.stackFrameFileFilter).toList.sortBy(_.getName)
}

object Stack extends Function3[Level, Mission, ObjectId, Stack] with CommonFormats{
  implicit val stackFormat = Json.format[Stack]
  
  val stackFrameRegEx = """stackImage[0-9]+\.png""".r
  val stackFrameFileFilter = new FileRegExFilter(stackFrameRegEx)
}