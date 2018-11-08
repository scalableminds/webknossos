package oxalis.security

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object TokenType extends Enumeration {
  type TokenType = Value

  val Authentication, DataStore, ResetPassword = Value

  implicit val enumReads: Reads[TokenType.Value] = EnumUtils.enumReads(TokenType)

  implicit def enumWrites: Writes[TokenType.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
