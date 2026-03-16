import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// 1. Unlock the .env file
dotenv.config(); 

const app = express();
app.use(cors()); 
app.use(express.json()); 

// 2. CONNECT TO THE VAULT
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Vault!'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// 3. DEFINE THE BLUEPRINT (Schema)
const jobSchema = new mongoose.Schema({
  title: String,
  company: String,
  location: String,
  salary: String,
  type: String
});

const Job = mongoose.model('Job', jobSchema);

// --- ROUTES ---

// READ: Fetch all jobs from MongoDB
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await Job.find(); 
    
    const formattedJobs = jobs.map(job => ({
      id: job._id, // Format ID for React
      title: job.title,
      company: job.company,
      location: job.location,
      salary: job.salary,
      type: job.type
    }));
    
    res.json(formattedJobs);
  } catch (error) {
    console.error("❌ GET ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// CREATE: Save a new job to MongoDB
app.post('/api/jobs', async (req, res) => {
  try {
    const newJob = await Job.create(req.body); 
    
    res.status(201).json({
      id: newJob._id, // Format ID for React
      title: newJob.title,
      company: newJob.company,
      location: newJob.location,
      salary: newJob.salary,
      type: newJob.type
    }); 
  } catch (error) {
    // This catches the panic and tells us exactly why it failed!
    console.error("❌ SERVER PANIC REASON (POST):", error.message);
    res.status(500).json({ error: "Failed to save job" }); 
  }
});

// DELETE: Remove a job from MongoDB
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id); 
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    console.error("❌ DELETE ERROR:", error.message);
    res.status(500).json({ error: "Failed to delete job" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server is live on http://localhost:${PORT}`);
});