package oxalis.security

import com.scalableminds.util.enumeration.ExtendedEnumeration

object TokenType extends ExtendedEnumeration {
  type TokenType = Value
  val Authentication, DataStore, ResetPassword = Value
}
