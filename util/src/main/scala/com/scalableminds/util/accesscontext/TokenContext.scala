package com.scalableminds.util.accesscontext

// to be used in datastore and tracingstore to hand around tokens that were supplied with the request
case class TokenContext(userTokenOpt: Option[String])
