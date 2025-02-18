package security

import models.user.{MultiUserDAO, WebAuthnCredential, WebAuthnCredentialDAO}
import com.yubico.webauthn._
import com.yubico.webauthn.data._
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.typesafe.scalalogging.Logger
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.slf4j.LoggerFactory

import java.util.Optional
import javax.inject.Inject
import scala.jdk.CollectionConverters._

object WebAuthnCredentialRepository {
  def byteArrayToHex(arr: ByteArray): String = arr.getHex
  def hexToByteArray(hex: String): ByteArray = ByteArray.fromHex(hex)

  def objectIdToByteArray(id: ObjectId): ByteArray = new ByteArray(id.toString.getBytes())
  def byteArrayToObjectId(arr: ByteArray): ObjectId = new ObjectId(new String(arr.getBytes))
}

/*
 * UserHandle => ObjectId
 * Username => User's E-Mail address
 */

class WebAuthnCredentialRepository @Inject()(multiUserDAO: MultiUserDAO, webAuthnCredentialDAO: WebAuthnCredentialDAO) extends CredentialRepository {
  def getCredentialIdsForUsername(email: String): java.util.Set[PublicKeyCredentialDescriptor] = {
    val user = multiUserDAO.findOneByEmail(email)(GlobalAccessContext).get("Java interop")
    val keys = webAuthnCredentialDAO.findAllForUser(user._id)(GlobalAccessContext).get("Java interop");
    keys.map(key => {
      PublicKeyCredentialDescriptor.builder()
        .id(WebAuthnCredentialRepository.hexToByteArray(key._id))
        .build()
    }).to(Set).asJava
  }

  def getUserHandleForUsername(email: String): Optional[ByteArray] = {
    val user = multiUserDAO.findOneByEmail(email)(GlobalAccessContext).get("Java interop")
    Optional.ofNullable(WebAuthnCredentialRepository.objectIdToByteArray(user._id))
  }

  def getUsernameForUserHandle(handle: ByteArray): Optional[String] = {
    val id = WebAuthnCredentialRepository.byteArrayToObjectId(handle)
    val user = multiUserDAO.findOneById(id)(GlobalAccessContext).get("Java interop")
    Optional.ofNullable(user.email)
  }

  def lookup(credentialId: ByteArray, userHandle: ByteArray): Optional[RegisteredCredential] = {
    val credId = WebAuthnCredentialRepository.byteArrayToHex(credentialId)
    val userId = WebAuthnCredentialRepository.byteArrayToObjectId(userHandle)
    val credential = webAuthnCredentialDAO.findByIdAndUserId(credId, userId)(GlobalAccessContext).await("Java interop") match {
      case Full(credential) => credential;
      case Empty => return Optional.empty();
    }
    Optional.ofNullable(RegisteredCredential.builder()
      .credentialId(WebAuthnCredentialRepository.hexToByteArray(credential._id))
      .userHandle(WebAuthnCredentialRepository.objectIdToByteArray(credential._multiUser))
      .publicKeyCose(new ByteArray(credential.publicKeyCose))
      .signatureCount(credential.signatureCount)
      .build())
  }

  def lookupAll(credentialId: ByteArray): java.util.Set[RegisteredCredential] = {
    webAuthnCredentialDAO.listById(WebAuthnCredentialRepository.byteArrayToHex(credentialId))(GlobalAccessContext).await("Java interop") match {
        case Full(credentials: List[WebAuthnCredential]) =>
          credentials
            .map(credential => {
              RegisteredCredential.builder()
                .credentialId(WebAuthnCredentialRepository.hexToByteArray(credential._id))
                .userHandle(WebAuthnCredentialRepository.objectIdToByteArray(credential._multiUser))
                .publicKeyCose(new ByteArray(credential.publicKeyCose))
                .signatureCount(credential.signatureCount)
                .build()
            })
            .toSet
            .asJava
        case Empty => Set[RegisteredCredential]().asJava
      }
  }

}
