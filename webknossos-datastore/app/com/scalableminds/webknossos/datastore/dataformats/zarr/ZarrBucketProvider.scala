package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.FileSystem

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Empty}

class ZarrCube(zarrArray: ZarrArray) extends DataCube with LazyLogging with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.globalXInMag, bucket.globalYInMag, bucket.globalZInMag)
    tryo(onError = e => logError(e))(zarrArray.readBytesXYZ(shape, offset))
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val zarrMagOpt: Option[ZarrMag] =
      layer.mags.find(_.mag == readInstruction.bucket.resolution)
    zarrMagOpt.map { zarrMag =>
      zarrMag.remoteSource match {
        case Some(remoteSource) => loadRemote(remoteSource)
        case None               => loadLocal(readInstruction, zarrMag.pathWithFallback)
      }
    }.getOrElse(Empty)
  }

  private def loadRemote(remoteSource: RemoteSourceDescriptor): Box[ZarrCube] = {
    val layerPathOpt = FileSystemsHolder.getOrCreate(remoteSource).map { fileSystem: FileSystem =>
      fileSystem.getPath(remoteSource.remotePath)
    }
    layerPathOpt match {
      case None => Empty
      case Some(layerPath) =>
        tryo(onError = e => logError(e))(ZarrArray.open(layerPath)).map(new ZarrCube(_))
    }
  }

  private def loadLocal(readInstruction: DataReadInstruction, magPath: String): Box[ZarrCube] = {
    val layerPath = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
      .resolve(magPath)
    if (layerPath.toFile.exists()) {
      tryo(onError = e => logError(e))(ZarrArray.open(layerPath)).map(new ZarrCube(_))
    } else Empty
  }

}
