package brainflight.security

import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.HttpsURLConnection

object InsecureSSLSocketFactory {
  lazy val default = HttpsURLConnection.getDefaultSSLSocketFactory()
  lazy val socketFactory = {val trustAllCerts = Array[TrustManager]( new X509TrustManager() {
        override def checkClientTrusted( chain: Array[X509Certificate], authType: String ) {
        }
        override def checkServerTrusted( chain: Array[X509Certificate], authType: String ) {
        }
        override def getAcceptedIssuers():Array[X509Certificate]  = {
            return null;
        }
    })
    
    // Install the all-trusting trust manager
    val sslContext = SSLContext.getInstance( "SSL" );
    sslContext.init( null, trustAllCerts, new java.security.SecureRandom() );
    // Create an ssl socket factory with our all-trusting manager
    sslContext.getSocketFactory();
  }
  
  def load() {
    HttpsURLConnection.setDefaultSSLSocketFactory( socketFactory )
  }
  
  def unload() {
    HttpsURLConnection.setDefaultSSLSocketFactory( default ) 
  }
  
  def usingSelfSignedCert(block: => Unit){
    load()
    block
    unload()
  }
}