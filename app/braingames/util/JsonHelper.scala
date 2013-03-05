package braingames.util

import java.io.File
import scala.io.Source
import play.api.libs.json._

object JsonHelper {
  def JsonFromFile(file: File) = Json.parse(Source.fromFile(file).getLines.mkString)
}