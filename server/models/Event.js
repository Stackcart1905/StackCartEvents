import mongoose from 'mongoose'

const formFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  type: {
    type: String,
    enum: ['shortText', 'longText', 'email', 'number', 'singleChoice', 'multipleChoice', 'image', 'video'],
    required: true,
  },
  required: { type: Boolean, default: true },
  options: { type: [String], default: [] },
}, { _id: false })

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 20000 },
  deadline: { type: Date, required: true },
  thumbnail: { type: String, required: true },
  formFields: { type: [formFieldSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

export default mongoose.model('Event', eventSchema)
