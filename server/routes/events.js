import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { fileTypeFromFile } from 'file-type'
import Event from '../models/Event.js'
import Application from '../models/Application.js'
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js'
import { parseFormFields, validateAnswer } from '../services/forms.js'

const router = Router()
const directory = path.dirname(fileURLToPath(import.meta.url))
const uploadDirectory = path.resolve(directory, '../uploads')
const privateUploadDirectory = path.resolve(directory, '../privateUploads')
const choiceTypes = new Set(['singleChoice', 'multipleChoice'])
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'])

await Promise.all([
  fs.mkdir(uploadDirectory, { recursive: true }),
  fs.mkdir(privateUploadDirectory, { recursive: true }),
])

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, privateUploadDirectory),
    filename: (_request, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 11, fields: 32, fieldSize: 512 * 1024 },
})

const parseEventFields = (request, response) => {
  const parsed = parseFormFields(request.body?.formFields)
  if (parsed.error) {
    response.status(400).json({ message: parsed.error })
    return null
  }
  return parsed.fields
}

const validateEventDetails = (request, response) => {
  const body = request.body || {}
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const deadlineValue = typeof body.deadline === 'string' ? body.deadline : ''
  const deadline = new Date(deadlineValue)
  if (!title || title.length > 120 || !description || description.length > 20000 || !deadlineValue || Number.isNaN(deadline.getTime())) {
    response.status(400).json({ message: 'Enter a title, description, and valid application deadline.' })
    return null
  }
  return { title, description, deadline }
}

const eventResponse = async (events, participantId) => {
  const list = Array.isArray(events) ? events : [events]
  const counts = await Application.aggregate([
    { $match: { event: { $in: list.map((event) => event._id) } } },
    { $group: { _id: '$event', count: { $sum: 1 } } },
  ])
  const countById = new Map(counts.map(({ _id, count }) => [_id.toString(), count]))
  const appliedIds = participantId
    ? new Set((await Application.find({
      event: { $in: list.map((event) => event._id) },
      participant: participantId,
    }).select('event')).map((application) => application.event.toString()))
    : new Set()
  const result = list.map((event) => ({
    ...event.toObject(),
    participantCount: countById.get(event._id.toString()) || 0,
    isApplied: appliedIds.has(event._id.toString()),
  }))
  return Array.isArray(events) ? result : result[0]
}

const removeFile = async (folder, filename) => {
  if (!filename || path.basename(filename) !== filename) return
  await fs.unlink(path.join(folder, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

const cleanupUploads = async (files = []) => {
  await Promise.all(files.map((file) => removeFile(privateUploadDirectory, file.filename)))
}

const inspectUploads = async (files, formFields, mode) => {
  const fieldsById = new Map(formFields.map((field) => [field.id, field]))
  const foundFiles = new Map()
  let thumbnail = null
  for (const file of files) {
    if (file.fieldname === 'thumbnail' && mode !== 'participant') {
      if (thumbnail) return { error: 'Choose only one event thumbnail.' }
      if (file.size > 5 * 1024 * 1024) return { error: 'Event thumbnails must be 5 MB or smaller.' }
      const detected = await fileTypeFromFile(file.path)
      if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
        return { error: 'Event thumbnails must be JPEG, PNG, or WebP images.' }
      }
      thumbnail = { ...file, detected }
      continue
    }

    const match = /^file_([\w-]{1,64})$/.exec(file.fieldname)
    const field = match ? fieldsById.get(match[1]) : null
    if (!field || !['image', 'video'].includes(field.type)) {
      return { error: 'An uploaded file does not match an event form question.' }
    }
    if (foundFiles.has(field.id)) return { error: `${field.label} accepts one file.` }
    const detected = await fileTypeFromFile(file.path)
    const isImage = field.type === 'image' && detected && imageTypes.has(detected.mime)
    const isVideo = field.type === 'video' && detected && videoTypes.has(detected.mime)
    if (!isImage && !isVideo) {
      return { error: `${field.label} must be a valid ${field.type === 'image' ? 'image' : 'video'} file.` }
    }
    if (field.type === 'image' && file.size > 10 * 1024 * 1024) {
      return { error: 'Image answers must be 10 MB or smaller.' }
    }
    if (field.type === 'video' && file.size > 50 * 1024 * 1024) {
      return { error: 'Video answers must be 50 MB or smaller.' }
    }
    foundFiles.set(field.id, { ...file, detected })
  }
  if (mode === 'admin' && !thumbnail) return { error: 'Please choose an event thumbnail.' }
  return { filesByField: foundFiles, thumbnail }
}

const moveThumbnailToPublic = async (file, response) => {
  const filename = `${randomUUID()}.${file.detected.ext}`
  const destination = path.join(uploadDirectory, filename)
  await fs.rename(file.path, destination)
  response.locals.movedThumbnail = filename
  return `/uploads/${filename}`
}

const parseAnswers = (value) => {
  if (value !== undefined && typeof value !== 'string') return null
  try {
    const answers = JSON.parse(value || '{}')
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null
    return answers
  } catch {
    return null
  }
}

const normalizeApplicationAnswers = (eventFields, answerValues, filesByField) => {
  const fieldIds = new Set(eventFields.map((field) => field.id))
  if (Object.keys(answerValues).some((id) => !fieldIds.has(id))) {
    return { error: 'The application contains answers for unknown questions.' }
  }
  const answers = []
  for (const field of eventFields) {
    if (field.type === 'image' || field.type === 'video') {
      const file = filesByField.get(field.id)
      if (!file) {
        if (field.required) return { error: `${field.label} is required.` }
        answers.push({ fieldId: field.id, label: field.label, type: field.type, value: null })
        continue
      }
      answers.push({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: {
          filename: file.filename,
          originalName: file.originalname.split(/[\\/]/).pop().slice(0, 200),
          contentType: file.detected.mime,
          size: file.size,
        },
      })
      continue
    }
    const validation = validateAnswer(field, answerValues[field.id])
    if (validation.error) return validation
    answers.push({ fieldId: field.id, label: field.label, type: field.type, value: validation.value })
  }
  return { answers }
}

router.get('/', optionalAuth, async (request, response, next) => {
  try {
    const events = await Event.find().sort({ deadline: 1, createdAt: -1 })
    return response.json({ events: await eventResponse(events, request.user?._id) })
  } catch (error) {
    return next(error)
  }
})

router.get('/:id', optionalAuth, async (request, response, next) => {
  try {
    const event = await Event.findById(request.params.id)
    if (!event) return response.status(404).json({ message: 'Event not found.' })
    return response.json({ event: await eventResponse(event, request.user?._id) })
  } catch (error) {
    return next(error)
  }
})

router.post('/:id/apply', requireAuth, requireRole('participant'), upload.any(), async (request, response, next) => {
  try {
    const event = await Event.findById(request.params.id)
    if (!event) {
      await cleanupUploads(request.files)
      return response.status(404).json({ message: 'Event not found.' })
    }
    if (event.deadline.getTime() <= Date.now()) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: 'The application deadline for this event has passed.' })
    }
    const inspected = await inspectUploads(request.files || [], event.formFields, 'participant')
    if (inspected.error) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: inspected.error })
    }
    const answerValues = parseAnswers(request.body?.answers)
    if (!answerValues) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: 'The application answers are invalid.' })
    }
    const result = normalizeApplicationAnswers(event.formFields, answerValues, inspected.filesByField)
    if (result.error) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: result.error })
    }
    try {
      await Application.create({
        event: event._id,
        participant: request.user._id,
        answers: result.answers,
      })
    } catch (error) {
      await cleanupUploads(request.files)
      if (error.code === 11000) return response.status(409).json({ message: 'You have already applied for this event.' })
      throw error
    }
    return response.status(201).json({ message: 'Your application has been received.' })
  } catch (error) {
    await cleanupUploads(request.files || []).catch((cleanupError) => console.error(cleanupError))
    return next(error)
  }
})

router.get('/:id/participants', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    const event = await Event.findById(request.params.id).select('_id')
    if (!event) return response.status(404).json({ message: 'Event not found.' })
    const applications = await Application.find({ event: event._id })
      .sort({ createdAt: -1 })
      .populate('participant', 'name email')
    return response.json({
      participants: applications.map((application) => ({
        name: application.participant.name,
        email: application.participant.email,
        appliedAt: application.createdAt,
        answers: application.answers.map((answer) => ({
          fieldId: answer.fieldId,
          label: answer.label,
          type: answer.type,
          value: answer.value?.filename
            ? {
              url: `/api/events/submission-files/${encodeURIComponent(answer.value.filename)}`,
              originalName: answer.value.originalName,
              contentType: answer.value.contentType,
            }
            : answer.value,
        })),
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/submission-files/:filename', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    const filename = request.params.filename
    if (!/^[\w-]{1,64}$/.test(filename)) {
      return response.status(404).json({ message: 'Submission file not found.' })
    }
    const application = await Application.findOne({
      answers: { $elemMatch: { 'value.filename': filename } },
    })
    if (!application) return response.status(404).json({ message: 'Submission file not found.' })
    const answer = application.answers.find((item) => item.value?.filename === filename)
    return response.download(
      path.join(privateUploadDirectory, filename),
      answer.value.originalName,
      (error) => {
        if (error && !response.headersSent) next(error)
      },
    )
  } catch (error) {
    return next(error)
  }
})

router.post('/', requireAuth, requireRole('admin'), upload.any(), async (request, response, next) => {
  try {
    const details = validateEventDetails(request, response)
    if (!details) {
      await cleanupUploads(request.files)
      return
    }
    const formFields = parseEventFields(request, response)
    if (!formFields) {
      await cleanupUploads(request.files)
      return
    }
    const inspected = await inspectUploads(request.files || [], formFields, 'admin')
    if (inspected.error) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: inspected.error })
    }
    const thumbnail = await moveThumbnailToPublic(inspected.thumbnail, response)
    const event = await Event.create({
      ...details,
      formFields,
      thumbnail,
      createdBy: request.user._id,
    })
    response.locals.eventSaved = true
    return response.status(201).json({ event: await eventResponse(event) })
  } catch (error) {
    await cleanupUploads(request.files || []).catch((cleanupError) => console.error(cleanupError))
    if (response.locals.movedThumbnail && !response.locals.eventSaved) {
      await removeFile(uploadDirectory, response.locals.movedThumbnail).catch((cleanupError) => console.error(cleanupError))
    }
    return next(error)
  }
})

router.patch('/:id', requireAuth, requireRole('admin'), upload.any(), async (request, response, next) => {
  try {
    const details = validateEventDetails(request, response)
    if (!details) {
      await cleanupUploads(request.files)
      return
    }
    const formFields = parseEventFields(request, response)
    if (!formFields) {
      await cleanupUploads(request.files)
      return
    }
    const inspected = await inspectUploads(request.files || [], formFields, 'edit')
    if (inspected.error) {
      await cleanupUploads(request.files)
      return response.status(400).json({ message: inspected.error })
    }
    const event = await Event.findById(request.params.id)
    if (!event) {
      await cleanupUploads(request.files)
      return response.status(404).json({ message: 'Event not found.' })
    }
    const oldThumbnail = event.thumbnail
    Object.assign(event, details, { formFields })
    if (inspected.thumbnail) event.thumbnail = await moveThumbnailToPublic(inspected.thumbnail, response)
    await event.save()
    response.locals.eventSaved = true
    if (inspected.thumbnail) {
      await removeFile(uploadDirectory, path.basename(oldThumbnail)).catch((error) => console.error(error))
    }
    return response.json({ event: await eventResponse(event) })
  } catch (error) {
    await cleanupUploads(request.files || []).catch((cleanupError) => console.error(cleanupError))
    if (response.locals.movedThumbnail && !response.locals.eventSaved) {
      await removeFile(uploadDirectory, response.locals.movedThumbnail).catch((cleanupError) => console.error(cleanupError))
    }
    return next(error)
  }
})

router.delete('/:id', requireAuth, requireRole('admin'), async (request, response, next) => {
  try {
    const event = await Event.findById(request.params.id)
    if (!event) return response.status(404).json({ message: 'Event not found.' })
    const applications = await Application.find({ event: event._id }).select('answers')
    const submissionFiles = applications.flatMap((application) =>
      application.answers.map((answer) => answer.value?.filename).filter(Boolean),
    )
    await Application.deleteMany({ event: event._id })
    await event.deleteOne()
    await Promise.all([
      removeFile(uploadDirectory, path.basename(event.thumbnail)),
      ...submissionFiles.map((filename) => removeFile(privateUploadDirectory, filename)),
    ])
    return response.json({ message: 'Event deleted.' })
  } catch (error) {
    return next(error)
  }
})

export default router
