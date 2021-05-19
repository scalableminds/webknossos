package models.user

import com.scalableminds.util.enumeration.ExtendedEnumeration

object Theme extends ExtendedEnumeration {
  type Theme = Value
  val light, dark, auto = Value
}
