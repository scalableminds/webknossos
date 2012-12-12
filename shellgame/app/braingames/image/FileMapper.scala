package braingames.image

import java.io.PrintWriter
import java.io.File

object FileMapper {
  def serializeMapping(mapping: Map[String, Array[String]]) = {
    import net.liftweb.json._
    import net.liftweb.json.JsonDSL._
    import net.liftweb.json.Serialization.{ read, write }
    implicit val formats = Serialization.formats(NoTypeHints)
    write(mapping)
  }

  def writeToFile(mapping: Map[String, Array[String]], fileName: String) {
    println("Writing file mapping to '%s'".format(fileName))
    val file = new File(fileName)
    val out = new PrintWriter(file)
    try { out.print(serializeMapping(mapping)) }
    finally { out.close }
  }
}