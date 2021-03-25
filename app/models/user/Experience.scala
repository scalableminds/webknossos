package models.user

import play.api.libs.json.{Json, OFormat}

/**
  * Experience a user needs to hold to acquire a task. The task itself defines the minimum experience needed.
  * @param domain Domain of the experience
  * @param value Amount of experience
  */
case class Experience(domain: String, value: Int) {
  def trim: Experience = this.copy(domain = this.domain.trim)
}

object Experience {
  implicit val jsonFormat: OFormat[Experience] = Json.format[Experience]
}
