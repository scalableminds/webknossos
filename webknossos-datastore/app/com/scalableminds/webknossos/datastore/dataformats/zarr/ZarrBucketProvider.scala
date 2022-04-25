package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.{FileSystem, Path}

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Empty}

import scala.concurrent.ExecutionContext

class ZarrCubeHandle(zarrArray: ZarrArray) extends DataCubeHandle with LazyLogging with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.globalXInMag, bucket.globalYInMag, bucket.globalZInMag)
    zarrArray.readBytesXYZ(shape, offset)
    // TODO error handling? had to remove the tryo
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCubeHandle] = {
    val zarrMagOpt: Option[ZarrMag] =
      layer.mags.find(_.mag == readInstruction.bucket.resolution)

    val magPathOpt: Option[Path] = zarrMagOpt.flatMap { zarrMag =>
      zarrMag.remoteSource match {
        case Some(remoteSource) => remotePathFrom(remoteSource)
        case None               => localPathFrom(readInstruction, zarrMag.pathWithFallback)
      }
    }

    magPathOpt match {
      case None => Empty
      case Some(magPath) =>
        tryo(onError = e => logError(e))(ZarrArray.open(magPath)).map(new ZarrCubeHandle(_))
    }
  }

  private def remotePathFrom(remoteSource: RemoteSourceDescriptor): Option[Path] =
    FileSystemsHolder.getOrCreate(remoteSource).map { fileSystem: FileSystem =>
      fileSystem.getPath(remoteSource.remotePath)
    }

  private def localPathFrom(readInstruction: DataReadInstruction, relativeMagPath: String): Option[Path] = {
    val magPath = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
      .resolve(relativeMagPath)
    if (magPath.toFile.exists()) {
      Some(magPath)
    } else None
  }

}
