package braingames.util

import java.io.File
import java.io.BufferedInputStream
import java.io.FileInputStream
import java.io.OutputStream
import java.io.InputStream
import scala.collection.immutable.TreeSet
import play.api.Logger
import org.kamranzafar.jtar.TarOutputStream
import org.kamranzafar.jtar.TarEntry

object TarIO {
  /** The size of the byte or char buffer used in various methods.*/

  def tar(sources: Seq[(File, String)], out: OutputStream) =
    if(sources.size > 0)
      writeTar(sources, new TarOutputStream(out))

  private def writeTar(sources: Seq[(File, String)], tar: TarOutputStream) = {
    val files = sources.map { case (file, name) => (file, normalizeName(name)) }
    val t = System.currentTimeMillis()
    files.foreach {
      case (f, name) =>
        tar.putNextEntry(new TarEntry(f, name))
        val in = new BufferedInputStream(new FileInputStream(f))
        var buffer = new Array[Byte](1024)
        var len = 0
        do{ 
          len = in.read(buffer)
          if(len > 0)
            tar.write(buffer, 0, len)
        } while(len > 0)
        tar.flush()
        in.close()
    }
    Logger.trace(s"TAR compression of ${sources.size} elemens took ${System.currentTimeMillis-t}ms")
    tar.close()
  }

  private def normalizeName(name: String) =
    {
      val sep = File.separatorChar
      if (sep == '/') name else name.replace(sep, '/')
    }
}