package models.organization

import play.api.libs.json.{Format, JsError, JsNumber, JsResult, JsString, JsSuccess, JsValue, Json}

case class ByteCount(numBytes: Long)

object ByteCount {

  private def fromString(s: String): Option[ByteCount] = {
    val normalized = s.replace(" ", "").replace("_", "")
    val pattern = """^(\d+)(B|KB|MB|GB|TB)?$""".r
    val multipliers = Map("B" -> 1L, "KB" -> 1000L, "MB" -> 1000000L, "GB" -> 1000000000L, "TB" -> 1000000000000L)
    pattern.findFirstMatchIn(normalized).map { m =>
      val digits = m.group(1).toLong
      val multiplier = Option(m.group(2)).flatMap(multipliers.get).getOrElse(1L)
      ByteCount(digits * multiplier)
    }
  }

  implicit object ByteCountJsonFormat extends Format[ByteCount] {
    def reads(json: JsValue): JsResult[ByteCount] = json match {
      case JsString(s) =>
        ByteCount.fromString(s).map(JsSuccess(_)).getOrElse(JsError("Invalid ByteCount: " + s))
      case JsNumber(n) =>
        JsSuccess(ByteCount(n.toLong))
      case _ =>
        JsError("Invalid ByteCount")
    }

    def writes(v: ByteCount): JsValue =
      Json.toJson(v.numBytes)
  }

}
