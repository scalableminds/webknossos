FROM eclipse-temurin:21-jammy
ARG VERSION_NODE="18.x"

RUN curl -sL "https://deb.nodesource.com/setup_${VERSION_NODE}" | bash - \
  && apt-get -y install libblosc1 libbrotli1 postgresql-client libdraco4 git nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /webknossos
WORKDIR /webknossos

COPY target/universal/stage .

RUN addgroup --system --gid 999 webknossos \
  && adduser --system --uid 999 --ingroup webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos . \
  && chmod go+x bin/webknossos \
  && chmod go+w .

RUN echo '#!/bin/bash\numask 002\nbin/webknossos "$@"\n' > /docker-entrypoint.sh \
  && chmod +x /docker-entrypoint.sh

HEALTHCHECK \
  --interval=1m --timeout=5s --retries=10 \
  CMD curl --fail http://localhost:9000/api/buildinfo || exit 1

USER webknossos

EXPOSE 9000

ENTRYPOINT [ "/docker-entrypoint.sh" ]
