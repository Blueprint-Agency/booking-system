import 'dotenv/config'
import app from './app'
import { registerJobs } from './jobs'

const PORT = process.env.PORT ?? 3001

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  registerJobs()
})
