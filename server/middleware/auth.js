import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const requireAuth = async (request, response, next) => {
  const token = request.cookies.stackcart_session
  if (!token) return response.status(401).json({ message: 'Please sign in to continue.' })
  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return response.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
  const user = await User.findById(payload.sub).select('_id name email role')
  if (!user) return response.status(401).json({ message: 'Your session is no longer valid.' })
  request.user = user
  return next()
}

export const optionalAuth = async (request, _response, next) => {
  const token = request.cookies.stackcart_session
  if (!token) return next()
  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return next()
  }
  request.user = await User.findById(payload.sub).select('_id name email role') || undefined
  return next()
}

export const requireRole = (role) => (request, response, next) => {
  if (request.user?.role !== role) {
    return response.status(403).json({ message: 'You do not have permission to do that.' })
  }
  return next()
}
