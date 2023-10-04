package com.scalableminds.webknossos.datastore

import brave.play.filter.ZipkinTraceFilter

import javax.inject.Inject
import play.api.http.HttpFilters
import play.api.mvc.EssentialFilter
import play.filters.headers.SecurityHeadersFilter

class Filters @Inject()(securityHeadersFilter: SecurityHeadersFilter, zipkinTraceFilter: ZipkinTraceFilter)
    extends HttpFilters {
  def filters: Seq[EssentialFilter] = Seq(securityHeadersFilter, zipkinTraceFilter)
}
