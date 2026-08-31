package models.user

import com.scalableminds.util.tools.AutoFormat

/** Experience a user needs to hold to acquire a task. The task itself defines the minimum experience needed.
  * @param domain
  *   Domain of the experience
  * @param value
  *   Amount of experience
  */
case class Experience(domain: String, value: Int) derives AutoFormat {
  def trim: Experience = this.copy(domain = this.domain.trim)
}
