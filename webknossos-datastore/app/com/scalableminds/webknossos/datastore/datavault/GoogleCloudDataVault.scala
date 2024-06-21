package com.scalableminds.webknossos.datastore.datavault

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.{BlobId, BlobInfo, Storage, StorageException, StorageOptions}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{GoogleServiceAccountCredential, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.ByteBuffer
import scala.concurrent.ExecutionContext

class GoogleCloudDataVault(uri: URI, credential: Option[GoogleServiceAccountCredential]) extends DataVault {

  private lazy val storageOptions: StorageOptions = credential match {
    case Some(credential: GoogleServiceAccountCredential) =>
      StorageOptions
        .newBuilder()
        .setCredentials(
          ServiceAccountCredentials.fromStream(new ByteArrayInputStream(credential.secretJson.toString.getBytes)))
        .build()
    case _ => StorageOptions.newBuilder().build()
  }

  private lazy val storage: Storage = storageOptions.getService

  // gs://bucket-name/object/name  -> getAuthority -> bucket-name
  // Get bucket name with *getAuthority*. *Authority* is used here because *host* may only contain alphanumeric chars or
  // dashes, excluding chars that may be part of the bucket name (e.g. underscore).
  private lazy val bucket: String = uri.getAuthority

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = {

    val objName = path.toUri.getPath.tail
    val blobId = BlobId.of(bucket, objName)
    for {
      bytes <- try {
        range match {
          case StartEnd(r) =>
            val blobReader = storage.reader(blobId)
            blobReader.seek(r.start)
            blobReader.limit(r.end)
            val bb = ByteBuffer.allocateDirect(r.length)
            blobReader.read(bb)
            val arr = new Array[Byte](r.length)
            bb.position(0)
            bb.get(arr)
            Fox.successful(arr)
          case SuffixLength(l) =>
            val blobReader = storage.reader(blobId)
            blobReader.seek(-l)
            val bb = ByteBuffer.allocateDirect(l)
            blobReader.read(bb)
            val arr = new Array[Byte](l)
            bb.position(0)
            bb.get(arr)
            Fox.successful(arr)
          case Complete() => Fox.successful(storage.readAllBytes(bucket, objName))
        }
      } catch {
        case s: StorageException =>
          if (s.getCode == 404)
            Fox.empty
          else Fox.failure(s.getMessage)
        case t: Throwable => Fox.failure(t.getMessage)
      }
      blobInfo <- tryo(BlobInfo.newBuilder(blobId).setContentType("text/plain").build)
      encoding <- Encoding.fromRfc7231String(Option(blobInfo.getContentEncoding).getOrElse(""))
    } yield (bytes, encoding)
  }

  override def listDirectory(path: VaultPath)(implicit ec: ExecutionContext): Fox[List[VaultPath]] = Fox.successful(List.empty)

  private def getUri = uri
  private def getCredential = credential

  override def equals(obj: Any): Boolean = obj match {
    case other: GoogleCloudDataVault => other.getUri == uri && other.getCredential == credential
    case _                           => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(uri).append(credential).toHashCode
}

object GoogleCloudDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor): GoogleCloudDataVault = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential])
    new GoogleCloudDataVault(remoteSourceDescriptor.uri, credential)
  }
}
