import bcrypt from 'bcryptjs'
import User from '../models/User.js'

export const seedAdmin = async () => {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase()
  const password = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
  await User.findOneAndUpdate(
    { email },
    {
      $set: { role: 'admin', password, name: 'StackCart Admin' },
      $setOnInsert: { email },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  )
}
