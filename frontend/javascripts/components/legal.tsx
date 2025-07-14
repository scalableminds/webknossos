import { getDefaultOrganization, getOperatorData } from "admin/rest_api";
import { Card, Col, Row } from "antd";
import Markdown from "libs/markdown_adapter";
import type React from "react";
import { useEffect, useState } from "react";
import type { APIOrganization } from "types/api_types";

const useLegalData = () => {
  const [operatorData, setOperatorData] = useState("");
  const [defaultOrganization, setDefaultOrganization] = useState<APIOrganization | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const operatorData = await getOperatorData();
        const defaultOrg = await getDefaultOrganization();
        setOperatorData(operatorData);
        setDefaultOrganization(defaultOrg);
      } catch (error) {
        console.error("Failed to fetch legal data:", error);
      }
    };

    fetchData();
  }, []);

  return { operatorData, defaultOrganization };
};

export const Imprint: React.FC = () => {
  const { operatorData, defaultOrganization } = useLegalData();

  return (
    <div className="container" id="impressum">
      <Row>
        <Col offset={6} span={12}>
          <h2>Imprint</h2>
          <Card>
            <Markdown>{operatorData}</Markdown>
          </Card>
          <p />
          {defaultOrganization != null ? (
            <Card>
              <Markdown>{defaultOrganization?.additionalInformation}</Markdown>
            </Card>
          ) : null}
        </Col>
      </Row>
    </div>
  );
};

export const Privacy: React.FC = () => {
  const { operatorData, defaultOrganization } = useLegalData();
  return (
    <div className="container text">
      <Row>
        <Col offset={6} span={12}>
          <h2>Privacy Statement</h2>

          <p>
            WEBKNOSSOS is a team-based open-source tool for exploring and collaboratively annotating
            3D image datasets. Viewing datasets is possible without a registration. However, if
            users want to create annotations or perform any other changes to the system, they need
            to have a registered account. Personal data is processed in WEBKNOSSOS. This privacy
            statement describes the data that is processed, the rights data subjects have, what
            external services are used and other privacy-related information.
          </p>

          <h3>Definitions</h3>
          <ul>
            <li>
              &quot;<strong>WEBKNOSSOS</strong>&quot; is the application that can be used for
              viewing and annotating 3D image datasets.
            </li>
            <li>
              An &quot;<strong>instance</strong>&quot; of WEBKNOSSOS is one installation of the
              application on a server with one domain name attached (e.g. https://webknossos.org).
            </li>
            <li>
              Persons that use WEBKNOSSOS are &quot;<strong>users</strong>&quot; or &quot;
              <strong>you</strong>&quot; (in GDPR terms &quot;
              <strong>data subjects</strong>
              &quot;).
            </li>
            <li>
              &quot;<strong>Anonymous users</strong>&quot; are users that do not have a registered
              account with WEBKNOSSOS.
            </li>
            <li>
              &quot;<strong>Registered users</strong>&quot; have an account. WEBKNOSSOS processes
              personal data of users.
            </li>
            <li>
              An instance that the user uses is referred to as the &quot;
              <strong>service</strong>
              &quot;.
            </li>
            <li>
              The &quot;<strong>controller</strong>&quot; is the person or legal entity that is
              responsible for the processing of personal data within the meaning of GDPR (see GDPR
              Art. 4 (7) for full definition).
            </li>
            <li>
              A research group or research lab or other entity that uses WEBKNOSSOS for their team
              is technically represented as an &quot;
              <strong>organization</strong>&quot; in WEBKNOSSOS. The organization or their
              representative is the data controller of the information within their instance of
              WEBKNOSSOS.
            </li>
            <li>
              When multiple organizations share a WEBKNOSSOS instance, they are joint controllers
              for shared information (e.g. data of anonymous users) and single controllers for
              organization-specific information (e.g. data of registered users).
            </li>
            <li>
              WEBKNOSSOS may be provided as a hosted service. In that case, the hosting provider is
              a &quot;<strong>processor</strong>&quot; within the meaning of GDPR (see GDPR Art. 4
              (8) for full definition). The processor performs data processing on behalf of the
              controller.
            </li>
            <li>
              &quot;<strong>We</strong>&quot; generally means both controller and processor.
            </li>
          </ul>

          <h3>Data controller</h3>
          {defaultOrganization != null ? (
            <div key={defaultOrganization.id}>
              <Markdown>{defaultOrganization.additionalInformation}</Markdown>
            </div>
          ) : null}

          <h3>Data processor</h3>
          <Markdown>{operatorData}</Markdown>

          <h3>Your Data</h3>
          <ul>
            <li>
              In order to provide the WEBKNOSSOS application, several external services are used.
              Some personal data of users may be transmitted to these services as described below.
              <ul>
                <li>
                  Google Analytics (with the anonymizer function) is a web analytics service. Web
                  analytics is the collection, gathering, and analysis of data about the behavior of
                  visitors to websites. A web analysis service collects, inter alia, data about
                  which features were used, or how often and for what duration a feature has been
                  used. Web analytics are used for the optimization and maintenance of a website.
                  The legal basis for using Google Analytics is a legitimate interest to provide and
                  improve the service. Read more below.
                </li>
                <li>
                  Airbrake is an error reporting tool. System errors that occur in the application
                  are logged in Airbrake. When an error occurs the IP address of the user, as well
                  as the user account information of registered users, are transmitted to Airbrake.
                  The purpose of error reporting is to resolve errors and therefore to ensure
                  uninterrupted service. Airbrake is operated by Airbrake Technologies, Inc., 535
                  Mission Street, 14th floor, San Francisco, CA 94105, USA. After 30 days data is
                  automatically deleted from the service. The legal basis for using Airbrake is a
                  legitimate interest to provide and improve the service.
                </li>
                <li>
                  Request logs are collected that contain a series of general data and information
                  when a data subject or automated systems calls up WEBKNOSSOS. This general data
                  and information are stored in the server log files. Collected may be (1) the
                  browser types and versions used, (2) the operating system used by the accessing
                  system, (3) the website from which an accessing system reaches our website
                  (so-called referrers), (4) the sub-websites, (5) the date and time of access to
                  the Internet site, (6) an Internet protocol address (IP address), (7) the Internet
                  service provider of the accessing system, and (8) any other similar data and
                  information that may be used in the event of attacks on our information technology
                  systems. This data is used for resolving errors and therefore to ensure
                  uninterrupted service. Logs are automatically deleted after 30 days. The legal
                  basis for collecting logs is a legitimate interest to provide and improve the
                  service.
                </li>
              </ul>
            </li>
            <li>
              For registered users we store and process the following pieces of personal data:
              <ul>
                <li>First/Last name</li>
                <li>Email address</li>
                <li>Organization affiliation</li>
                <li>Encrypted password</li>
                <li>Activity times</li>
                <li>Application configurations</li>
              </ul>
              This data is attached to the user&apos;s account. It is used to identify the
              annotation data that was created by the user and for administrative purposes. The
              legal bases are user consent (upon signup) or legitimate interests in order to provide
              the Service.
            </li>
            <li>
              Registered users may participate in discussions on the WEBKNOSSOS discuss platform.
              Posts and replies that they make there are visible to other WEBKNOSSOS users (also
              from other WEBKNOSSOS instances). Their posts and replies may be removed at any time.
            </li>
            <li>
              Registered users may choose to publish datasets or annotations they have created or
              uploaded or are maintaining. This data will then be publicly available to everybody on
              the internet. Personal data such as name, email address and organization affiliation
              may be made public as well in order to provide the attribution that is common within
              the scientific community. Users may unpublish their work at any time.
            </li>
            <li>
              For scientific purposes, it may be required to retain personal information in order to
              provide attribution and accountability.
            </li>
            <li>
              We do not sell, trade, share, or rent the personal data collected from our Service to
              third parties other than as outlined in this policy.
            </li>
          </ul>

          <h3>Your rights</h3>
          <ul>
            <li>
              If you wish to confirm, access, update/correct or request deletion of your personal
              data, you can do so by contacting us.
            </li>
            <li>
              You can always object to processing the of your personal data, please ask us to
              restrict processing of your personal data or request a data export. Again, you can do
              so by contacting us.
            </li>
            <li>
              You have the right to complain to a data protection authority about our collection and
              use of your personal data. For more information, please contact your local data
              protection authority.
            </li>
            <li>
              You can request an archive of the data we have stored about you. Again, to file for
              such a request, please contact us.
            </li>
          </ul>
          <h3>Legal basis</h3>
          <p>
            Art. 6(1) lit. a GDPR serves as the legal basis for processing operations for which we
            obtain consent for a specific processing purpose. If the processing of personal data is
            necessary for the performance of a contract to which the data subject is a party, as is
            the case, for example, when processing operations are necessary for the supply of goods
            or to provide any other service, the processing is based on Article 6(1) lit. b GDPR.
            The same applies to such processing operations which are necessary for carrying out
            pre-contractual measures, for example in the case of inquiries concerning our products
            or services. Are we subject to a legal obligation by which processing of personal data
            is required, such as for the fulfillment of tax obligations, the processing is based on
            Art. 6(1) lit. c GDPR.
          </p>
          <p>
            In case of a hosted WEBKNOSSOS service, the processing is performed by the processor on
            behalf of the controller.
          </p>
          <h3>Data security</h3>
          <p>
            The processor has implemented a number of technological and organizational measures in
            order to maintain the safety and integrity of your data.
          </p>
          <ul>
            <li>
              Servers are actively maintained and updated with state-of-the-art technologies and
              security patches to prevent malware and attackers.
            </li>
            <li>Unusual resource consumption is regularly monitored. </li>
            <li>
              Access control to the servers is implemented with encrypted challenge-response
              methods.
            </li>
            <li>Employees are granted access to the servers only if they need it. </li>
            <li>Regular and encrypted backups are implemented and monitored. </li>
            <li>
              Employees are required to attend regular privacy training in order to ensure
              responsible handling of personal data.
            </li>
            <li>
              Suppliers and integrated services are evaluated and inspected on a regular basis.
            </li>
          </ul>
          <h3>Changes</h3>
          <p>
            We reserve the right to update or modify this Privacy Policy from time to time without
            prior notice. Please review this document especially before you provide any information.
            This Privacy Policy was last updated on the date indicated below. Your continued use of
            the Services after any changes or revisions to this Privacy Policy shall indicate your
            agreement with the terms of such revised Privacy Policy.
          </p>
          <p>
            If you have any questions, comments or just want to say hi, feel free to write an email
            to <a href="mailto:privacy@scalableminds.com">privacy@scalableminds.com</a>
          </p>

          <p>Date: May 25, 2018</p>
        </Col>
      </Row>
    </div>
  );
};
