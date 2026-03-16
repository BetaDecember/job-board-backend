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

const jobSchema = new mongoose.Schema({
  title: String,
  company: String,
  location: String,
  salary: String,
  type: String,
  applyUrl: String 
});

const Job = mongoose.model('Job', jobSchema);

// 🛡️ NEW: THE BOUNCER
// This function checks if the password sent from React matches your secret Vault password
const requireAdmin = (req, res, next) => {
  const providedPassword = req.headers['x-admin-password'];
  
  // We will set ADMIN_PASS in Render in the next step!
  if (providedPassword === process.env.ADMIN_PASS) {
    next(); // ✅ Password matches! Let them through to the database.
  } else {
    res.status(401).json({ error: "Unauthorized: Incorrect admin password!" }); // ❌ Kick them out
  }
};

// --- ROUTES ---

// 📖 READ is public! Anyone can view jobs. (No Bouncer here)
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await Job.find(); 
    const formattedJobs = jobs.map(job => ({
      id: job._id, title: job.title, company: job.company, 
      location: job.location, salary: job.salary, type: job.type, applyUrl: job.applyUrl 
    }));
    res.json(formattedJobs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// 📝 CREATE is protected! (Notice the 'requireAdmin' in the middle)
app.post('/api/jobs', requireAdmin, async (req, res) => {
  try {
    const newJob = await Job.create(req.body); 
    res.status(201).json({
      id: newJob._id, title: newJob.title, company: newJob.company,
      location: newJob.location, salary: newJob.salary, type: newJob.type, applyUrl: newJob.applyUrl 
    }); 
  } catch (error) {
    res.status(500).json({ error: "Failed to save job" }); 
  }
});

// 🗑️ DELETE is protected!
app.delete('/api/jobs/:id', requireAdmin, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id); 
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
}); 

// ✏️ UPDATE is protected!
app.put('/api/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedJob) return res.status(404).json({ error: "Job not found" });

    res.json({
      id: updatedJob._id, title: updatedJob.title, company: updatedJob.company,
      location: updatedJob.location, salary: updatedJob.salary, type: updatedJob.type, applyUrl: updatedJob.applyUrl
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update job" });
  }
});  

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server is live on http://localhost:${PORT}`);
});