{ Component } = require("react")

update = (obj, keys, value) ->
  key = keys[0]
  new_obj = {}
  if keys.length == 1
    new_obj[key] = value
  else
    new_obj[key] = update(obj[key], keys.slice(1), value)
  return Object.assign({}, obj, new_obj)


class FormComponent extends Component

  makeFieldHandler : (field) ->
    return (event) => @handleFieldChange(field, event.target.value)


  handleFieldChange : (field, value) ->
    this.setState({ value: update(this.state.value, field.split("."), value) })

  getField : (field) ->
    value = this.state.value
    for key in field.split(".")
      value = value[key]
    return value

  handleSubmit : (event) =>
    event.preventDefault()
    this.props.onSubmit(this.state.value)

module.exports = FormComponent