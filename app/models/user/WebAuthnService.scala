package models.user

import utils.ObjectId
import org.apache.pekko.actor.ActorSystem
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.yubico.webauthn.data._
import com.yubico.webauthn._
import java.util.Optional
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.collection.mutable.ArrayBuffer
import scala.collection.JavaConverters._

case class WebAuthnRegistration (
  userId: ObjectId,
  key: PublicKeyCredentialDescriptor,
  publicKey: ByteArray,
  var signatureCount: Long,
  attestation: ByteArray,
  clientDataJSON: ByteArray,
  )

class WebAuthnService @Inject()(registrations: ArrayBuffer[WebAuthnRegistration]) extends CredentialRepository {
  def store(
    userId: ObjectId,
    key: PublicKeyCredentialDescriptor,
    publicKey: ByteArray,
    signatureCount: Long,
    attestation: ByteArray,
    clientDataJSON: ByteArray
    ): Unit = {
    registrations += WebAuthnRegistration(userId, key, publicKey, signatureCount, attestation, clientDataJSON)
  }

  def update(
    userId: ObjectId,
    key: PublicKeyCredentialDescriptor,
    signatureCount: Long,
    ): Boolean = {
      registrations.find(element => element.userId.id == userId.id && element.key.compareTo(key) == 0) match {
        case Some(registration) =>  {
          val i = registrations.indexOf(registration)
          registrations(i).signatureCount = signatureCount
          true
        }
        case None => false
      }
  }

  def iterate(userId: ObjectId): Iterator[WebAuthnRegistration] = {
    registrations.filter(registration => registration.userId.id == userId.id).iterator
  }

  def getCredentialIdsForUsername(username: String): java.util.Set[PublicKeyCredentialDescriptor] = {
    println("username:" + username)
    var result: Set[PublicKeyCredentialDescriptor] = Set()
    result.asJava
  }

  def getUserHandleForUsername(name: String): Optional[ByteArray] = {
    println("name:" + name)
    Optional.ofNullable(null)
}

  def getUsernameForUserHandle(userHandle: ByteArray): Optional[String] = {
    println("handle:" + userHandle.getHex())
    Optional.ofNullable(null)
  }

  def lookup(credentialId: ByteArray, userHandle: ByteArray): Optional[RegisteredCredential] = {
    println("credentialId: " + credentialId.getHex() + " userHandle:" + userHandle.getHex())
    Optional.ofNullable(null)
  }

  def lookupAll(credentialId: ByteArray): java.util.Set[RegisteredCredential] = {
    println("credentialId:", credentialId.getHex())
    var result: Set[RegisteredCredential] = Set()
    result.asJava
  }
}
