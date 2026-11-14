import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFormFields, validateAnswer } from './forms.js'

test('parses valid dynamic form definitions', () => {
  const parsed = parseFormFields(JSON.stringify([
    { id: 'name', label: 'Your name', type: 'shortText', required: true },
    { id: 'idea', label: 'Choose an idea', type: 'singleChoice', required: false, options: ['A', 'B'] },
    { id: 'work', label: 'Upload your work', type: 'image', required: true },
  ]))
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.fields.length, 3)
})

test('rejects duplicate IDs, malformed choices, and excess questions', () => {
  const duplicate = parseFormFields(JSON.stringify([
    { id: 'same', label: 'First', type: 'shortText', required: true },
    { id: 'same', label: 'Second', type: 'email', required: false },
  ]))
  assert.match(duplicate.error, /unique ID/)

  const noChoices = parseFormFields(JSON.stringify([
    { id: 'choice', label: 'Pick one', type: 'singleChoice', required: true, options: ['Only one'] },
  ]))
  assert.match(noChoices.error, /between 2 and 20/)

  const tooMany = parseFormFields(JSON.stringify(
    Array.from({ length: 31 }, (_, index) => ({
      id: `field-${index}`,
      label: `Question ${index}`,
      type: 'shortText',
      required: false,
    })),
  ))
  assert.match(tooMany.error, /up to 30/)
})

test('validates required and optional text answers', () => {
  const required = { id: 'name', label: 'Name', type: 'shortText', required: true, options: [] }
  const optional = { ...required, required: false }
  assert.match(validateAnswer(required, '   ').error, /required/)
  assert.deepEqual(validateAnswer(optional, '   '), { value: null })
  assert.deepEqual(validateAnswer(required, ' Sam '), { value: 'Sam' })
})

test('normalizes and validates email and numeric answers', () => {
  const email = { id: 'email', label: 'Email', type: 'email', required: true, options: [] }
  const number = { id: 'age', label: 'Age', type: 'number', required: true, options: [] }
  assert.deepEqual(validateAnswer(email, ' PERSON@example.com '), { value: 'person@example.com' })
  assert.match(validateAnswer(email, 'invalid').error, /valid email/)
  assert.deepEqual(validateAnswer(number, '42'), { value: 42 })
  assert.match(validateAnswer(number, 'many').error, /valid number/)
})

test('accepts only configured choice options', () => {
  const single = { id: 'time', label: 'Time', type: 'singleChoice', required: true, options: ['Morning', 'Evening'] }
  const multiple = { ...single, type: 'multipleChoice' }
  assert.deepEqual(validateAnswer(single, 'Morning'), { value: 'Morning' })
  assert.match(validateAnswer(single, 'Night').error, /valid option/)
  assert.deepEqual(validateAnswer(multiple, ['Morning', 'Evening']), { value: ['Morning', 'Evening'] })
  assert.match(validateAnswer(multiple, ['Morning', 'Morning']).error, /valid options/)
})
