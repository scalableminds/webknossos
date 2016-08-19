_              = require("lodash")
app            = require("app")
Backbone       = require("backbone")
UserCollection = require("admin/models/user/user_collection")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")
ProjectModel   = require("admin/models/project/project_model")
React          = require("react")
ReactDOM       = require("react-dom")
SelectionView  = require("./selection_view")
FormComponent  = require("libs/react/form_component")
{
  FormControlNumeric,
  FormContainer,
  FieldGroup,
  FieldGroupControl,
} = require("libs/react/form_utils")
{
  Row,
  Col,
  Well,
  Form,
  FormGroup,
  FormControl,
  ControlLabel,
  Radio,
  Button,
} = require("react-bootstrap")



class ProjectCreateForm extends FormComponent

  constructor : ->
    super
    this.state = {
      value: {
        "team": "",
        "name": "",
        "owner": "",
        "priority": 100,
        "assignmentConfiguration" : {
          "location" : "webknossos",
          "assignmentDurationInSeconds" : 3600,
          "rewardInDollar" : 0.05,
          "autoApprovalDelayInSeconds" : 60000,
          "title" : "",
          "keywords": "",
          "description" : "",
        }
      }
    }


  render : ->
    value = this.state.value
    return (
      <FormContainer title="Create Project">
        <Form horizontal onSubmit={this.handleSubmit}>

          <FieldGroupControl
            label="Project Name"
            type="text"
            required
            pattern=".\{3,50\}"
            title="Please use at least 3 characters."
            autoFocus
            name="name"
            valueOwner={this}
          />

          <FieldGroup label="Team">
            {###<SelectionView
              collection={this.props.teams}
              valueExtractor={(item) -> item.get("name")}
              value={value.team}
              onChange={this.makeFieldHandler("team")}
            />###}
          </FieldGroup>

          <FieldGroup label="Owner">
            <SelectionView
              collectionType={UserCollection}
              collectionOptions={{ data:"isAdmin=true" }}
              valueExtractor={(item) -> item.id}
              labelExtractor={(item) -> "#{item.get("firstName")} #{item.get("lastName")} (#{item.get("email")})"}
              defaultItem={{ email : app.currentUser.email }}
              value={value.owner}
              onChange={this.makeFieldHandler("owner")}
            />
          </FieldGroup>

          <FieldGroupControl
            label="Priority"
            name="priority"
            type="number"
            required
            valueOwner={this}
          />

          <FieldGroup label="Project Type">
            <Radio
              inline
              checked={value.assignmentConfiguration.location == "webknossos"}
              onChange={this.makeFieldHandler("assignmentConfiguration.location")}
              value="webknossos"
            >webknossos</Radio>
            <Radio
              inline
              checked={value.assignmentConfiguration.location == "mturk"}
              value="mturk"
              onChange={this.makeFieldHandler("assignmentConfiguration.location")}
            >Mechanical Turk</Radio>
          </FieldGroup>

          {
            if value.assignmentConfiguration.location == "mturk"
              <div>
                <Col sm={9} smOffset={3}>
                  <h4>Mechanical Turk settings</h4>
                </Col>

                <FieldGroupControl
                  label="Assignment duration in seconds"
                  name="assignmentConfiguration.assignmentDurationInSeconds"
                  type="number"
                  valueOwner={this}
                />

                <FieldGroupControl
                  label="Reward in USD"
                  name="assignmentConfiguration.rewardInDollar"
                  type="number"
                  step="0.01"
                  valueOwner={this}
                />

                <FieldGroupControl
                  label="Auto approval delay in seconds"
                  name="assignmentConfiguration.autoApprovalDelayInSeconds"
                  type="number"
                  valueOwner={this}
                />

                <FieldGroupControl
                  label="Title"
                  name="assignmentConfiguration.title"
                  type="text"
                  valueOwner={this}
                />

                <FieldGroupControl
                  label="Keywords"
                  name="assignmentConfiguration.keywords"
                  type="text"
                  valueOwner={this}
                />

                <FieldGroupControl
                  label="Description"
                  name="assignmentConfiguration.description"
                  componentClass="textarea"
                  rows="3"
                  valueOwner={this}
                />

              </div>
          }

          <FormGroup>
            <Col sm={2} smOffset={10}>
              <Button type="submit" block bsStyle="primary">Create Project</Button>
            </Col>
          </FormGroup>
        </Form>
      </FormContainer>
    )


class ProjectCreateView extends Backbone.View

  initialize : ->

    @model._isNew = true

    @userCollection = new UserCollection()
    @userCollection.fetch({ data: "isAdmin=true" })
    @listenTo(@userCollection, "all", @render)

    @teamCollection = new TeamCollection()
    @teamCollection.fetch({ data: "amIAnAdmin=true" })
    @listenTo(@teamCollection, "all", @render)

  render : ->

    ReactDOM.render(<ProjectCreateForm
      users={@userCollection}
      teams={@teamCollection}
      onSubmit={@createProject}
    />, this.el)
    return this


  createProject : (formValues) =>
    console.log(formValues)
    # @model.save(formValues).then(
    #   -> app.router.navigate("/projects", { trigger: true })
    # )


module.exports = ProjectCreateView
