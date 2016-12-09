FROM openjdk:8-jdk

# Install mongo tools for evolutions
RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927 \
  && echo "deb http://repo.mongodb.org/apt/debian wheezy/mongodb-org/3.2 main" | tee /etc/apt/sources.list.d/mongodb-org-3.2.list \
  && apt-get update \
  && apt-get install -y mongodb-org-shell=3.2.1 mongodb-org-tools=3.2.1

ENV PROJECT "webknossos"

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

COPY target/universal/stage .
COPY buildtools/cmd.sh .

RUN groupadd -r app-user \
  && useradd -r -g app-user app-user \
  && mkdir disk \
  && chown -R app-user . \
  && sed -i s/BRANCH/$BRANCH/g conf/newrelic.yml

USER app-user

CMD [ "./cmd.sh" ]
