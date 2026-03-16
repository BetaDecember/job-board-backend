import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); 

const app = express();
app.use(cors()); 
app.use(express.json()); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Vault!'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// 🌟 NEW: Added applyUrl to the Blueprint!
const jobSchema = new mongoose.Schema({
  title: String,
  company: String,
  location: String,
  salary: String,
  type: String,
  applyUrl: String 
});

const Job = mongoose.model('Job', jobSchema);

// --- ROUTES ---

app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await Job.find(); 
    const formattedJobs = jobs.map(job => ({
      id: job._id, 
      title: job.title,
      company: job.company,
      location: job.location,
      salary: job.salary,
      type: job.type,
      applyUrl: job.applyUrl // 🌟 Included in response
    }));
    res.json(formattedJobs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const newJob = await Job.create(req.body); 
    res.status(201).json({
      id: newJob._id, 
      title: newJob.title,
      company: newJob.company,
      location: newJob.location,
      salary: newJob.salary,
      type: newJob.type,
      applyUrl: newJob.applyUrl // 🌟 Included in response
    }); 
  } catch (error) {
    res.status(500).json({ error: "Failed to save job" }); 
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id); 
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
}); 

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedJob) return res.status(404).json({ error: "Job not found" });

    res.json({
      id: updatedJob._id,
      title: updatedJob.title,
      company: updatedJob.company,
      location: updatedJob.location,
      salary: updatedJob.salary,
      type: updatedJob.type,
      applyUrl: updatedJob.applyUrl // 🌟 Included in response
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update job" });
  }
});  

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server is live on http://localhost:${PORT}`);
});