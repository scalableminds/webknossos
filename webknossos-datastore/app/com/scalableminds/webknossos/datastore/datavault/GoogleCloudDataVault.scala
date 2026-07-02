package com.scalableminds.webknossos.datastore.datavault

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.Storage.BlobSourceOption
import com.google.cloud.storage.{BlobId, BlobInfo, Storage, StorageException, StorageOptions}
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Box, Fox}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.storage.{CredentializedUPath, GoogleServiceAccountCredential}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.ByteBuffer
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.{IterableHasAsScala, IteratorHasAsScala}

class GoogleCloudDataVault(uri: URI, credential: Option[GoogleServiceAccountCredential]) extends DataVault {

  private lazy val storageOptions: StorageOptions = credential match {
    case Some(credential: GoogleServiceAccountCredential) =>
      StorageOptions
        .newBuilder()
        .setCredentials(
          ServiceAccountCredentials.fromStream(new ByteArrayInputStream(credential.secretJson.toString.getBytes))
        )
        .build()
    case _ => StorageOptions.newBuilder().build()
  }

  private lazy val storage: Storage = storageOptions.getService

  // gs://bucket-name/object/name  -> getAuthority -> bucket-name
  // Get bucket name with *getAuthority*. *Authority* is used here because *host* may only contain alphanumeric chars or
  // dashes, excluding chars that may be part of the bucket name (e.g. underscore).
  private lazy val bucket: String = uri.getAuthority

  override def readBytesEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Encoding.Value, Option[String])] =
    for {
      objName <- getObjectName(path).toFox
      blobId = BlobId.of(bucket, objName)
      bytes <-
        try
          range match {
            case r: StartEndExclusiveByteRange =>
              val blobReader = storage.reader(blobId)
              blobReader.seek(r.start)
              blobReader.limit(r.end)
              val bb = ByteBuffer.allocateDirect(r.length)
              blobReader.read(bb)
              val arr = new Array[Byte](r.length)
              bb.position(0)
              bb.get(arr)
              Fox.successful(arr)
            case SuffixLengthByteRange(l) =>
              val blobReader = storage.reader(blobId)
              blobReader.seek(-l)
              val bb = ByteBuffer.allocateDirect(l)
              blobReader.read(bb)
              val arr = new Array[Byte](l)
              bb.position(0)
              bb.get(arr)
              Fox.successful(arr)
            case CompleteByteRange() =>
              Fox.successful(storage.readAllBytes(bucket, objName, BlobSourceOption.shouldReturnRawInputStream(true)))
          }
        catch {
          case s: StorageException =>
            if (s.getCode == 404)
              Fox.empty
            else Fox.failure(s.getMessage)
          case t: Throwable => Fox.failure(t.getMessage)
        }
      blobInfo: BlobInfo <- tryo(
        storage.get(
          blobId,
          Storage.BlobGetOption
            .fields(Storage.BlobField.SIZE, Storage.BlobField.CONTENT_TYPE, Storage.BlobField.CONTENT_ENCODING)
        )
      ).toFox ?~> "could not get blobInfo"
      encoding <- Encoding
        .fromRfc7231String(Option(blobInfo.getContentEncoding).getOrElse(""))
        .toFox ?~> "could not get encoding"
    } yield (bytes, encoding, Option(blobInfo.getSize).flatMap(size => range.toContentRangeHeaderWithLength(size)))

  override def listDirectory(path: VaultPath, maxItems: Int)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[List[VaultPath]] =
    (for {
      objName <- getObjectName(path)
      blobs <- tryo(
        storage.list(bucket, Storage.BlobListOption.prefix(objName), Storage.BlobListOption.currentDirectory())
      )
      subDirectories <- tryo(blobs.getValues.asScala.toList.filter(_.isDirectory).take(maxItems))
      paths <- subDirectories.map { dirBlob =>
        UPath.fromString(s"${uri.getScheme}://$bucket/${dirBlob.getBlobId.getName}").map(new VaultPath(_, this))
      }.toSingleBox("Invalid UPath")
    } yield paths).toFox

  override def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    (for {
      objName <- getObjectName(path)
      blobs <- tryo(
        storage.list(bucket, Storage.BlobListOption.prefix(objName))
      ) // no currentDirectory(); Do deep recursive listing
      totalSize <- tryo(blobs.iterateAll().iterator().asScala.map(_.getSize).foldLeft(0L)(_ + _))
    } yield totalSize).toFox

  private def getUri = uri
  private def getCredential = credential
  private def getObjectName(path: VaultPath): Box[String] =
    for {
      remoteUri <- path.toRemoteUri
    } yield remoteUri.getPath.tail

  override def equals(obj: Any): Boolean = obj match {
    case other: GoogleCloudDataVault => other.getUri == uri && other.getCredential == credential
    case _                           => false
  }

  private lazy val hashCodeCached = new HashCodeBuilder(17, 31).append(uri).append(credential).toHashCode

  override def hashCode(): Int = hashCodeCached

}

object GoogleCloudDataVault {
  def create(credentializedUpath: CredentializedUPath): Box[GoogleCloudDataVault] =
    for {
      credential <- tryo(credentializedUpath.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential]))
      remoteUri <- credentializedUpath.upath.toRemoteUri
    } yield new GoogleCloudDataVault(remoteUri, credential)
}
