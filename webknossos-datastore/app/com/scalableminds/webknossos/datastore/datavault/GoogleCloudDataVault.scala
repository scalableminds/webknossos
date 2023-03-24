package com.scalableminds.webknossos.datastore.datavault

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.{BlobId, Storage, StorageOptions}
import com.scalableminds.webknossos.datastore.storage.{GoogleServiceAccountCredential, RemoteSourceDescriptor}

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.ByteBuffer
import scala.collection.immutable.NumericRange

class GoogleCloudDataVault(uri: URI, credential: Option[GoogleServiceAccountCredential]) extends DataVault {

  lazy val storageOptions: StorageOptions = credential match {
    case Some(credential: GoogleServiceAccountCredential) =>
      StorageOptions
        .newBuilder()
        .setCredentials(
          ServiceAccountCredentials.fromStream(new ByteArrayInputStream(credential.secretJson.toString.getBytes)))
        .build()
    case _ => StorageOptions.newBuilder().build()
  }

  private lazy val storage: Storage = storageOptions.getService

  private lazy val bucket: String = uri.getHost

  override def readBytes(path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = {
    val objName = path.toUri.getPath.tail
    val blobId = BlobId.of(bucket, objName)
    range match {
      case Some(r) => {
        val blobReader = storage.reader(blobId)
        blobReader.seek(r.start)
        blobReader.limit(r.end)
        val bb = ByteBuffer.allocateDirect(r.length)
        blobReader.read(bb)
        val arr = new Array[Byte](r.length)
        bb.position(0)
        bb.get(arr)
        arr
      }
      case None => storage.readAllBytes(bucket, objName)
    }

  }
}

object GoogleCloudDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor): GoogleCloudDataVault = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential])
    new GoogleCloudDataVault(remoteSourceDescriptor.uri, credential)
  }
}
