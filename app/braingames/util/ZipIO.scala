package braingames.util

import java.util.zip.ZipOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.CRC32
import java.io.BufferedInputStream
import java.io.FileInputStream
import java.io.OutputStream
import java.io.InputStream
import scala.collection.immutable.TreeSet
import play.api.Logger
import java.util.zip.ZipFile

object ZipIO {
  /** The size of the byte or char buffer used in various methods.*/

  def zip(sources: Seq[(InputStream, String)], out: OutputStream) =
    writeZip(sources, new ZipOutputStream(out))

  private def writeZip(sources: Seq[(InputStream, String)], zip: ZipOutputStream) = {
    val files = sources.map { case (file, name) => (file, normalizeName(name)) }

    files.foreach {
      case (in, name) =>
        zip.putNextEntry(new ZipEntry(name))
        var b = in.read()
        while (b > -1) {
          zip.write(b)
          b = in.read()
        }
        in.close()
        zip.closeEntry()
    }
    zip.close()
  }

  def unzip(file: File): List[InputStream] = {
    val r = unzip(new java.util.zip.ZipFile(file))
    Logger.trace(s"ZIP file contaings ${r.size} files")
    r
  }

  def unzip(zip: ZipFile): List[InputStream] = {
    import collection.JavaConverters._
    zip
      .entries
      .asScala
      .filter(e => !e.isDirectory())
      .map(entry => zip.getInputStream(entry))
      .toList
  }

  private def normalizeName(name: String) =
    {
      val sep = File.separatorChar
      if (sep == '/') name else name.replace(sep, '/')
    }
}