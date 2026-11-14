import mongoose from 'mongoose'

const answerSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { _id: false })

const applicationSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  participant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  answers: { type: [answerSchema], default: [] },
}, { timestamps: true })

applicationSchema.index({ event: 1, participant: 1 }, { unique: true })

export default mongoose.model('Application', applicationSchema)
