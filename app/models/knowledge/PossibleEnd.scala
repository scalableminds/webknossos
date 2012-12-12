package models.knowledge

import play.api.libs.json.JsValue
import play.api.libs.json.Reads

case class PossibleEnd(id: Int, probability: Double)

object PossibleEnd {
  implicit object PossibleEndReads extends Reads[PossibleEnd] {
    val ID = "id"
    val PROBABILITY = "probability"

    def reads(js: JsValue) =
      PossibleEnd(
        (js \ ID).as[Int],
        (js \ PROBABILITY).as[Double])
  }
}