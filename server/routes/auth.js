import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
})
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
})

const issueSession = (user, response) => {
  const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' })
  response.cookie('stackcart_session', token, sessionCookieOptions())
  return response.json({
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  })
}

router.post('/register', authLimiter, async (request, response, next) => {
  try {
    const body = request.body || {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (name.length < 2 || name.length > 80 || email.length > 254 || !emailPattern.test(email)) {
      return response.status(400).json({ message: 'Enter a valid name and email address.' })
    }
    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return response.status(400).json({ message: 'Password must be at least 8 characters and no longer than 72 UTF-8 bytes.' })
    }
    if (email === process.env.ADMIN_EMAIL.trim().toLowerCase()) {
      return response.status(403).json({ message: 'This email is reserved for the admin account.' })
    }
    const user = await User.create({ name, email, password, role: 'participant' })
    return issueSession(user, response)
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ message: 'An account with this email already exists.' })
    return next(error)
  }
})

router.post('/login', authLimiter, async (request, response, next) => {
  try {
    const body = request.body || {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return response.status(401).json({ message: 'Email or password is incorrect.' })
    }
    const user = await User.findOne({ email }).select('+password')
    if (!user || !(await user.comparePassword(password))) {
      return response.status(401).json({ message: 'Email or password is incorrect.' })
    }
    return issueSession(user, response)
  } catch (error) {
    return next(error)
  }
})

router.post('/logout', (_request, response) => {
  response.clearCookie('stackcart_session', { ...sessionCookieOptions(), maxAge: undefined })
  return response.json({ message: 'Signed out.' })
})

router.get('/me', optionalAuth, (request, response) => {
  if (!request.user) return response.json({ user: null })
  const { _id, name, email, role } = request.user
  return response.json({ user: { id: _id, name, email, role } })
})

export default router
