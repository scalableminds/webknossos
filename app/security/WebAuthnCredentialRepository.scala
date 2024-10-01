package security

import com.yubico.webauthn.{CredentialRepository, RegisteredCredential}
import com.yubico.webauthn.data.{PublicKeyCredentialDescriptor, ByteArray}
import scala.collection.JavaConverters._
import java.util.Optional

class WebAuthnCredentialRepository() extends CredentialRepository {
  def getCredentialIdsForUsername(username: String): java.util.Set[PublicKeyCredentialDescriptor] = {
    var result: Set[PublicKeyCredentialDescriptor] = Set()
    result.asJava
  }

  def getUserHandleForUsername(name: String): Optional[ByteArray] =
    Optional.ofNullable(null)

  def getUsernameForUserHandle(userHandle: ByteArray): Optional[String] =
    Optional.ofNullable(null)

  def lookup(credentialId: ByteArray, userHandle: ByteArray): Optional[RegisteredCredential] =
    Optional.ofNullable(null)

  def lookupAll(credentialId: ByteArray): java.util.Set[RegisteredCredential] = {
    var result: Set[RegisteredCredential] = Set()
    result.asJava
  }
}
