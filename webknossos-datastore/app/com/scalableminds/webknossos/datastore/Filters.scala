package com.scalableminds.webknossos.datastore

import javax.inject.Inject

import play.api.http.HttpFilters
import play.filters.headers.SecurityHeadersFilter

class Filters @Inject()(securityHeadersFilter: SecurityHeadersFilter) extends HttpFilters {
  def filters = Seq(securityHeadersFilter)
}
