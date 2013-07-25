package oxalis.util

import com.mongodb.casbah.gridfs.Imports._

object ExtendedTypes {

  import play.api.libs.ws.WS.WSRequestHolder
  import com.ning.http.client.Realm.AuthScheme

  case class Auth(isEnabled: Boolean, username: String = "", password: String = "")

  implicit class ExtendedWSRequestHolder(r: WSRequestHolder) {
    def withAuth(a: Auth) = {
      if (a.isEnabled)
        r.withAuth(a.username, a.password, AuthScheme.BASIC)
      else
        r
    }
  }

  implicit class ExtendedGridFSDBFile(val f: GridFSDBFile) extends AnyVal {
    /**
     * Extracts a BufferdSource using the codec from this GridFSDBFile
     */
    def sourceWithCodec(codec: scala.io.Codec) = {
      scala.io.Source.fromInputStream(f.inputStream)(codec)
    }
  }
}