package models.knowledge

import java.io.File
import braingames.util.FileRegExFilter


case class Stack(level: Level, mission: Mission){
  val path = s"${level.stackFolder}/${mission.id}"
  val directory = new File(path)
  val zipFile = new File(s"$path/${level.name}_${mission.id}_stack.zip")
  val metaFile = new File(s"$path/meta.json")
  
  def isZipped = zipFile.exists
  def isProduced = directory.exists && metaFile.exists
  def images = directory.listFiles(Stack.stackImageFilter).toList
}

object Stack {
  val stackImageRegEx = """stackImage[0-9]+\.png""".r
  val stackImageFilter = new FileRegExFilter(stackImageRegEx)
}