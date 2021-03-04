package models.user

import play.api.libs.json.{Json, OFormat}

import scala.collection.breakOut
import scala.language.implicitConversions

/**
  * Experience a user needs to hold to acquire a task. The task itself defines the minimum experience needed.
  * @param domain Domain of the experience
  * @param value Amount of experience
  */
case class Experience(domain: String, value: Int) {

  override def toString: String = if (isEmpty) "" else s"$domain: $value"

  def isEmpty: Boolean = domain == "" && value == 0

  def toMap: Map[String, Int] =
    if (isEmpty)
      Map.empty
    else
      Map(domain -> value)
}

object Experience {
  implicit val experienceFormat: OFormat[Experience] = Json.format[Experience]

  type Experiences = Map[String, Int]

  implicit def MapToExperienceList(m: Map[String, Int]): List[Experience] =
    m.map {
      case (domain, value) => Experience(domain, value)
    }(breakOut)

  def empty: Experience = Experience("", 0)

  def fromForm(domain: String, value: Int): Experience = Experience(domain.trim, value)
}
