FROM openjdk:8-jdk

RUN apt-get update \
  && apt-get install -y mongodb-clients mongo-tools

ENV PROJECT "webknossos"

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .
COPY buildtools/cmd.sh .

RUN groupadd -r app-user \
  && useradd -r -g app-user app-user \
  && mkdir disk \
  && chown -R app-user .

USER app-user

CMD [ "./cmd.sh" ]
