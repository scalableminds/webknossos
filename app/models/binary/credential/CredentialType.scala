package models.binary.credential

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CredentialType extends ExtendedEnumeration {
  type CredentialType = Value

  val HTTP_Basic_Auth, S3_Access_Key, HTTP_Token, GCS = Value
}
