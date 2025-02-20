package security

import models.user.{MultiUserDAO, WebAuthnCredential, WebAuthnCredentialDAO}
import com.yubico.webauthn._
import com.yubico.webauthn.data._
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}

import java.util.Optional
import javax.inject.Inject
import scala.annotation.nowarn
import scala.jdk.CollectionConverters._

object WebAuthnCredentialRepository {
  def byteArrayToBytes(arr: ByteArray): Array[Byte] = arr.getBytes
  def bytesToByteArray(bytes: Array[Byte]): ByteArray = new ByteArray(bytes)

  def objectIdToByteArray(id: ObjectId): ByteArray = new ByteArray(id.toString.getBytes())
  def byteArrayToObjectId(arr: ByteArray): ObjectId = new ObjectId(new String(arr.getBytes))
}

/*
 * UserHandle => ObjectId
 * Username => User's E-Mail address
 */

@nowarn("cat=deprecation")
class WebAuthnCredentialRepository @Inject()(multiUserDAO: MultiUserDAO, webAuthnCredentialDAO: WebAuthnCredentialDAO) extends CredentialRepository with LazyLogging {
  def getCredentialIdsForUsername(email: String): java.util.Set[PublicKeyCredentialDescriptor] = {
    val result = for {
      user <- multiUserDAO.findOneByEmail(email)(GlobalAccessContext).await("Java interop")
      keys <- webAuthnCredentialDAO.findAllForUser(user._id)(GlobalAccessContext).await("Java interop")
      creds = keys.map(key => {
        PublicKeyCredentialDescriptor.builder()
          .id(WebAuthnCredentialRepository.bytesToByteArray(key.keyId))
          .build()
      })
    } yield creds;
    result match {
      case Full(creds) => creds.toSet.asJava;
      case Empty => Set[PublicKeyCredentialDescriptor]().asJava;
      case Failure(msg, _, _) => {
        logger.error(msg);
        Set[PublicKeyCredentialDescriptor]().asJava
      }
    }
  }

  def getUserHandleForUsername(email: String): Optional[ByteArray] = {
    multiUserDAO.findOneByEmail(email)(GlobalAccessContext).await("Java interop") match {
      case Full(user) => Optional.ofNullable(WebAuthnCredentialRepository.objectIdToByteArray(user._id))
      case Empty => Optional.empty()
      case Failure(msg, _, _) => {
        logger.error(msg);
        Optional.empty();
      }
    }
  }

  def getUsernameForUserHandle(handle: ByteArray): Optional[String] = {
    val id = WebAuthnCredentialRepository.byteArrayToObjectId(handle)
    multiUserDAO.findOneById(id)(GlobalAccessContext).await("Java interop") match {
      case Full(user) => Optional.ofNullable(user.email)
      case Empty => Optional.empty()
      case Failure(msg, _, _) => {
        logger.error(msg);
        Optional.empty();
      }
    }
  }

  def lookup(credentialId: ByteArray, userHandle: ByteArray): Optional[RegisteredCredential] = {
    val credId = WebAuthnCredentialRepository.byteArrayToBytes(credentialId)
    val userId = WebAuthnCredentialRepository.byteArrayToObjectId(userHandle)
    val result = for {
      credential <- webAuthnCredentialDAO.findByKeyIdAndUserId(credId, userId)(GlobalAccessContext).await("Java interop")
      registered = RegisteredCredential.builder()
        .credentialId(WebAuthnCredentialRepository.bytesToByteArray(credential.keyId))
        .userHandle(WebAuthnCredentialRepository.objectIdToByteArray(credential._multiUser))
        .publicKeyCose(new ByteArray((credential.publicKeyCose)))
        .signatureCount(credential.signatureCount)
        .build()
    } yield registered;
    result match {
      case Full(credential) => Optional.ofNullable(credential);
      case Empty => Optional.empty();
      case Failure(msg, _, _) => {
        logger.error(msg);
        Optional.empty()
      }
    }
  }

  def lookupAll(credentialId: ByteArray): java.util.Set[RegisteredCredential] = {
    webAuthnCredentialDAO.listByKeyId(WebAuthnCredentialRepository.byteArrayToBytes(credentialId))(GlobalAccessContext).await("Java interop") match {
        case Full(credentials: List[WebAuthnCredential]) =>
          credentials
            .map(credential => {
              RegisteredCredential.builder()
                .credentialId(WebAuthnCredentialRepository.bytesToByteArray(credential.keyId))
                .userHandle(WebAuthnCredentialRepository.objectIdToByteArray(credential._multiUser))
                .publicKeyCose(new ByteArray(credential.publicKeyCose))
                .signatureCount(credential.signatureCount)
                .build()
            })
            .toSet
            .asJava
        case Empty => Set[RegisteredCredential]().asJava
        case Failure(msg, _, _) => {
          logger.error(msg);
          Set[RegisteredCredential]().asJava
        }
      }
  }

}
