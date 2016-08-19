React = require("react")
_     = require("lodash")
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


# TODO: http://stackoverflow.com/questions/28072727/translating-between-cents-and-dollars-in-html-input-in-react/28077112#28077112
FormControlNumeric = (args) ->
  { value, onChange } = args
  props = _.omit(args, ["value", "onChange"])
  return (
    <FormControl onChange={onChange} value={value} {...props} />
  )


FormContainer = ({ title, children }) ->
  return (
    <div className="container">
      <Row>
        <Col sm={12}>
          <Well>
            <Col sm={9} smOffset={2}>
              <h3>{title}</h3>
            </Col>
            {children}
          </Well>
        </Col>
      </Row>
    </div>
  )


FieldGroup = ({ label, children }) ->
  return (
    <FormGroup>
      <Col componentClass={ControlLabel} sm={2} smOffset={1}>
        {label}
      </Col>
      <Col sm={6}>
        {children}
      </Col>
    </FormGroup>
  )

FieldGroupControl = (args) ->
  { label, name, valueOwner } = args
  props = _.omit(args, ["label", "name", "valueOwner"])

  return (
    <FieldGroup label={label}>
      <FormControl
        value={valueOwner.getField(name)}
        onChange={valueOwner.makeFieldHandler(name)}
        {...props}
      />
    </FieldGroup>
  )

module.exports = {
  FormControlNumeric,
  FormContainer,
  FieldGroup,
  FieldGroupControl,
}

