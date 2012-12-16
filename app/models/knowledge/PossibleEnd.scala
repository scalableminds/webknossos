package models.knowledge

import play.api.libs.json._

case class PossibleEnd(id: Int, probability: Double)

object PossibleEnd {
  implicit object PossibleEndReads extends Format[PossibleEnd] {
    val ID = "id"
    val PROBABILITY = "probability"

    def reads(js: JsValue) =
      PossibleEnd(
        (js \ ID).as[Int],
        (js \ PROBABILITY).as[Double])
        
    def writes(possibleEnd: PossibleEnd) = Json.obj (
        ID -> possibleEnd.id,
        PROBABILITY -> possibleEnd.probability
    )
  }
}