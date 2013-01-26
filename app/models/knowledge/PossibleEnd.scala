package models.knowledge

import play.api.libs.json._
import play.api.libs.functional.syntax._

case class PossibleEnd(id: Int, probability: Double)

object PossibleEnd {
  implicit val PossibleEndFormat :Format[PossibleEnd] =(
        (__ \ "id").format[Int] and
        (__ \ "probability").format[Double])(PossibleEnd.apply, unlift(PossibleEnd.unapply))
}