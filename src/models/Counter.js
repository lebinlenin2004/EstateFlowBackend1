import mongoose from 'mongoose'
const { Schema } = mongoose
const schema = new Schema({ organization: { type: Schema.Types.ObjectId, required: true }, key: { type: String, required: true }, seq: { type: Number, default: 0 } })
schema.index({ organization: 1, key: 1 }, { unique: true })
const Counter = mongoose.model('Counter', schema)

// Atomic per-organization sequence (property codes, and later lead and agreement numbers).
export async function nextSequence(orgId, key) {
  for (let i = 0; i < 2; i += 1) {
    try { return (await Counter.findOneAndUpdate({ organization: orgId, key }, { $inc: { seq: 1 } }, { new: true, upsert: true })).seq }
    catch (err) { if (err.code !== 11000 || i === 1) throw err } // two first-ever calls raced on the upsert; retry once
  }
}
export default Counter
