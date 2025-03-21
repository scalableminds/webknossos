FROM eclipse-temurin:21-jammy
ARG VERSION_NODE="18.x"

RUN curl -sL "https://deb.nodesource.com/setup_${VERSION_NODE}" | bash - \
  && apt-get -y install libblosc1 libbrotli1 postgresql-client libdraco4 git nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /webknossos
WORKDIR /webknossos

# Copy compiled Scala output from a previous build step, e.g. output of the Docker-dev image
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

ENV CERTIFICATE "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzY2FsYWJsZW1pbmRzIiwiaWF0IjoxNzM5ODExMTc3LCJleHAiOjE4OTM0NTYwMDAsImZlYXR1cmVzIjp7Im9wZW5JZENvbm5lY3RFbmFibGVkIjpmYWxzZSwic2VnbWVudEFueXRoaW5nRW5hYmxlZCI6ZmFsc2UsImVkaXRhYmxlTWFwcGluZ3NFbmFibGVkIjpmYWxzZX19.c_zBzj7bKPCXp5eTjFrCC4YmOxSH9uQx3BRMYbVx9dPsiCwlyvi7jepqOP7bS8QIcdoSHnrhHpZ-tQKkTi3rkw"

ENTRYPOINT [ "/docker-entrypoint.sh" ]
