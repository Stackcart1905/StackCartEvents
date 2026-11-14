export const formFieldTypes = new Set([
  'shortText',
  'longText',
  'email',
  'number',
  'singleChoice',
  'multipleChoice',
  'image',
  'video',
])

const choiceTypes = new Set(['singleChoice', 'multipleChoice'])

export const parseFormFields = (value) => {
  if (value !== undefined && typeof value !== 'string') {
    return { error: 'The application form definition is invalid.' }
  }
  let fields
  try {
    fields = JSON.parse(value || '[]')
  } catch {
    return { error: 'The application form definition is invalid.' }
  }
  if (!Array.isArray(fields) || fields.length > 30) {
    return { error: 'An event can have up to 30 application questions.' }
  }
  const ids = new Set()
  const normalized = []
  let uploadFieldCount = 0
  for (const field of fields) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      return { error: 'Each application question must be valid.' }
    }
    const { id, label, type, required, options = [] } = field
    if (
      typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || ids.has(id) ||
      typeof label !== 'string' || !label.trim() || label.trim().length > 120 ||
      !formFieldTypes.has(type) || typeof required !== 'boolean'
    ) {
      return { error: 'Each question needs a unique ID, a label, a supported type, and a required setting.' }
    }
    ids.add(id)
    if (type === 'image' || type === 'video') {
      uploadFieldCount += 1
      if (uploadFieldCount > 10) return { error: 'An event can have up to 10 file upload questions.' }
    }
    if (choiceTypes.has(type)) {
      if (
        !Array.isArray(options) || options.length < 2 || options.length > 20 ||
        options.some((option) => typeof option !== 'string' || !option.trim() || option.trim().length > 100)
      ) {
        return { error: 'Choice questions need between 2 and 20 valid options.' }
      }
      const cleanOptions = options.map((option) => option.trim())
      if (new Set(cleanOptions).size !== cleanOptions.length) {
        return { error: 'Choice options must be unique.' }
      }
      normalized.push({ id, label: label.trim(), type, required, options: cleanOptions })
    } else {
      if (!Array.isArray(options) || options.length !== 0) return { error: 'Only choice questions can have options.' }
      normalized.push({ id, label: label.trim(), type, required, options: [] })
    }
  }
  return { fields: normalized }
}

export const validateAnswer = (field, value) => {
  if (value === undefined || value === null || value === '') {
    return field.required ? { error: `${field.label} is required.` } : { value: null }
  }
  if (field.type === 'shortText' || field.type === 'longText') {
    if (typeof value !== 'string') return { error: `${field.label} must be text.` }
    const answer = value.trim()
    const maximum = field.type === 'shortText' ? 500 : 10000
    if (answer.length > maximum) return { error: `${field.label} is too long.` }
    if (!answer) return field.required ? { error: `${field.label} is required.` } : { value: null }
    return { value: answer }
  }
  if (field.type === 'email') {
    const email = typeof value === 'string' ? value.trim() : ''
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: `Enter a valid email address for ${field.label}.` }
    }
    return { value: email.toLowerCase() }
  }
  if (field.type === 'number') {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { error: `${field.label} must be a valid number.` }
    }
    const number = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value)
    if (!Number.isFinite(number)) return { error: `${field.label} must be a valid number.` }
    return { value: number }
  }
  if (field.type === 'singleChoice') {
    if (typeof value !== 'string' || !field.options.includes(value)) {
      return { error: `Choose a valid option for ${field.label}.` }
    }
    return { value }
  }
  if (field.type === 'multipleChoice') {
    if (
      !Array.isArray(value) || value.length > field.options.length ||
      value.some((option) => typeof option !== 'string' || !field.options.includes(option)) ||
      new Set(value).size !== value.length
    ) {
      return { error: `Choose valid options for ${field.label}.` }
    }
    if (field.required && value.length === 0) return { error: `${field.label} is required.` }
    return { value }
  }
  if (field.type === 'image' || field.type === 'video') {
    return { error: `${field.label} requires a file upload.` }
  }
  return { error: `${field.label} has an unsupported question type.` }
}
