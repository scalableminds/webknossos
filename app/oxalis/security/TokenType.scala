package oxalis.security

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

/**
  * Created by youri on 08.01.18.
  */
object TokenType extends Enumeration {
  type TokenTypeValue = Value

  val Authentication = Value("Authentication")
  val DataStore = Value("DataStore")
  val ResetPassword = Value("ResetPassword")


  implicit val enumReads: Reads[TokenTypeValue] = EnumUtils.enumReads(TokenType)

  implicit def enumWrites: Writes[TokenTypeValue] = EnumUtils.enumWrites
}
