/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.security

import java.security.cert.X509Certificate
import javax.net.ssl.{HttpsURLConnection, SSLContext, TrustManager, X509TrustManager}

object InsecureSSLSocketFactory {
  lazy val default = HttpsURLConnection.getDefaultSSLSocketFactory()
  lazy val socketFactory = {
    val trustAllCerts = Array[TrustManager](new X509TrustManager() {
      override def checkClientTrusted(chain: Array[X509Certificate], authType: String) {
      }

      override def checkServerTrusted(chain: Array[X509Certificate], authType: String) {
      }

      override def getAcceptedIssuers(): Array[X509Certificate] = {
        return null;
      }
    })

    // Install the all-trusting trust manager
    val sslContext = SSLContext.getInstance("SSL");
    sslContext.init(null, trustAllCerts, new java.security.SecureRandom());
    // Create an ssl socket factory with our all-trusting manager
    sslContext.getSocketFactory();
  }

  def load() {
    HttpsURLConnection.setDefaultSSLSocketFactory(socketFactory)
  }

  def unload() {
    HttpsURLConnection.setDefaultSSLSocketFactory(default)
  }

  def usingSelfSignedCert(block: => Unit) {
    load()
    block
    unload()
  }
}
