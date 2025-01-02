package com.scalableminds.util.accesscontext

// Used in datastore and tracingstore to hand around tokens that were supplied with the request
case class TokenContext(userTokenOpt: Option[String])
