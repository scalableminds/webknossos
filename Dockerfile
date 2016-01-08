FROM 1science/sbt:0.13.8-oracle-jre-8

# Install node
RUN apk add --update nodejs
RUN npm install -g bower gulp

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

ADD package.json package.json
RUN npm install

ADD project project
ADD version version
RUN sbt exit

ADD . .
# RUN gulp
RUN sbt compile

CMD [ "sbt", "run" ]
