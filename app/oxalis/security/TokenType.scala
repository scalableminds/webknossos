package oxalis.security

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils


object TokenTypeSQL extends Enumeration {
  type TokenTypeSQL = Value

  val Authentication, DataStore, ResetPassword = Value

  implicit val enumReads: Reads[TokenTypeSQL.Value] = EnumUtils.enumReads(TokenTypeSQL)

  implicit def enumWrites: Writes[TokenTypeSQL.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
