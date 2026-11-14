import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import mongoose from 'mongoose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import authRoutes from './routes/auth.js'
import eventRoutes from './routes/events.js'
import { seedAdmin } from './services/seedAdmin.js'

const required = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']
const missing = required.filter((key) => !process.env[key])
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.')
}
if (process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters long.')
}
if (Buffer.byteLength(process.env.ADMIN_PASSWORD, 'utf8') > 72) {
  throw new Error('ADMIN_PASSWORD must be no longer than 72 UTF-8 bytes.')
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL)) {
  throw new Error('ADMIN_EMAIL must be a valid email address.')
}

const app = express()
const port = Number(process.env.PORT || 5000)
const directory = path.dirname(fileURLToPath(import.meta.url))
const uploadDirectory = path.join(directory, 'uploads')

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use('/api', (request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next()
  const origin = request.get('origin')
  const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
  if (origin && origin !== allowedOrigin) {
    return response.status(403).json({ message: 'Requests from this origin are not allowed.' })
  }
  return next()
})
app.use('/uploads', express.static(uploadDirectory, { fallthrough: false }))
app.use('/api/auth', authRoutes)
app.use('/api/events', eventRoutes)
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ message: 'Request body must contain valid JSON.' })
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ message: 'Request body is too large.' })
  }
  if (error instanceof mongoose.Error.CastError) {
    return response.status(400).json({ message: 'Invalid resource identifier.' })
  }
  if (error.name === 'MulterError') {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'An uploaded file exceeds the 50 MB upload limit.'
      : 'Unable to upload one of the files.'
    return response.status(400).json({ message })
  }
  if (error.message === 'Only JPEG, PNG, and WebP images are allowed.') {
    return response.status(400).json({ message: error.message })
  }
  if (error.status === 404) {
    return response.status(404).json({ message: 'Resource not found.' })
  }
  console.error(error)
  return response.status(500).json({ message: 'An unexpected server error occurred.' })
})

try {
  await mongoose.connect(process.env.MONGODB_URI)
  await seedAdmin()
  app.listen(port, () => console.log(`StackCart Events API listening on port ${port}`))
} catch (error) {
  console.error('Unable to start StackCart Events API:', error)
  process.exitCode = 1
}
