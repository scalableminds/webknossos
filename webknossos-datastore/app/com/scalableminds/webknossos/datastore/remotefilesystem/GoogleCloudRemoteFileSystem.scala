package com.scalableminds.webknossos.datastore.remotefilesystem

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.{BlobId, Storage, StorageOptions}
import com.scalableminds.webknossos.datastore.storage.{GoogleServiceAccountCredential, RemoteSourceDescriptor}

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.ByteBuffer

class GoogleCloudRemoteFileSystem(uri: URI, credential: Option[GoogleServiceAccountCredential])
    extends RemoteFileSystem {

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
  private lazy val blobPrefix: String = uri.getPath.tail

  override def get(key: String, path: RemotePath, range: Option[Range]): Array[Byte] = {
    val objName = if (key.nonEmpty) {
      new URI(blobPrefix).resolve(path.getFileName.toString).resolve(key).toString
    } else {
      new URI(blobPrefix).resolve(path.getFileName.toString).toString
    }
    val blobId = BlobId.of(bucket, objName)
    range match {
      case Some(r) => {
        val blobReader = storage.reader(blobId)
        blobReader.seek(r.start)
        blobReader.limit(r.length)
        val bb = ByteBuffer.allocateDirect(r.length)
        blobReader.read(bb)
        val arr = new Array[Byte](r.length)
        bb.get(arr)
        arr
      }
      case None => storage.readAllBytes(bucket, objName)
    }

  }
}

object GoogleCloudRemoteFileSystem {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential])
    new RemotePath(remoteSourceDescriptor.uri,
                   new GoogleCloudRemoteFileSystem(remoteSourceDescriptor.uri, credential),
                   credential)
  }
}
