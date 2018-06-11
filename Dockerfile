FROM scalableminds/graalvm:master__49

RUN apk --no-cache add bash 'postgresql-client~10' shadow

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .

RUN groupadd -r webknossos \
  && useradd -r -g webknossos webknossos \
  && mkdir disk \
  && chown -R webknossos .

USER webknossos

RUN id && [ "$(id -u)" == "999" ] && [ "$(id -g)" == "999" ]

ENTRYPOINT [ "bin/oxalis" ]
