import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

dotenv.config(); 

const app = express();

app.use(helmet()); 

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { error: "Too many requests from this IP, please try again after 15 minutes." },
  standardHeaders: true, 
  legacyHeaders: false, 
});

app.use('/api/', limiter);

app.use(cors()); 
app.use(express.json()); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Vault!'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// 🌟 UPGRADED SCHEMA: Added description and logoUrl!
const jobSchema = new mongoose.Schema({
  title: String,
  company: String,
  location: String,
  salary: String,
  type: String,
  applyUrl: String,
  clicks: { type: Number, default: 0 },
  description: { type: String, default: '' }, // Option A
  logoUrl: { type: String, default: '' }      // Option B
});

const Job = mongoose.model('Job', jobSchema);

const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized: No token provided!" });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    next(); 
  } catch (error) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired token!" });
  }
};

// --- ROUTES ---

// 🔐 LOGIN
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASS) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token });
  } else {
    res.status(401).json({ error: "Incorrect password" });
  }
});

// 📖 READ ALL (Paginated)
app.get('/api/jobs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const totalJobs = await Job.countDocuments();
    const jobs = await Job.find().sort({ _id: -1 }).skip(skip).limit(limit); 
    
    // 🌟 UPGRADED: Included description & logoUrl in the outgoing package
    const formattedJobs = jobs.map(job => ({
      id: job._id, title: job.title, company: job.company, 
      location: job.location, salary: job.salary, type: job.type, applyUrl: job.applyUrl, clicks: job.clicks,
      description: job.description, logoUrl: job.logoUrl 
    }));
    
    res.json({ jobs: formattedJobs, currentPage: page, totalPages: Math.ceil(totalJobs / limit), totalJobs });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// 📖 READ ONE
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    
    res.json({
      id: job._id, title: job.title, company: job.company, 
      location: job.location, salary: job.salary, type: job.type, applyUrl: job.applyUrl, clicks: job.clicks,
      description: job.description, logoUrl: job.logoUrl
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

// 📈 INCREMENT CLICKS
app.patch('/api/jobs/:id/click', async (req, res) => {
  try {
    await Job.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
    res.json({ message: "Click tracked successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to track click" });
  }
});

// 📝 CREATE
app.post('/api/jobs', requireAdmin, async (req, res) => {
  try {
    const newJob = await Job.create(req.body); 
    res.status(201).json({
      id: newJob._id, title: newJob.title, company: newJob.company,
      location: newJob.location, salary: newJob.salary, type: newJob.type, applyUrl: newJob.applyUrl, clicks: newJob.clicks,
      description: newJob.description, logoUrl: newJob.logoUrl
    }); 
  } catch (error) {
    res.status(500).json({ error: "Failed to save job" }); 
  }
});

// 🗑️ DELETE
app.delete('/api/jobs/:id', requireAdmin, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id); 
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete job" });
  }
}); 

// ✏️ UPDATE
app.put('/api/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedJob) return res.status(404).json({ error: "Job not found" });

    res.json({
      id: updatedJob._id, title: updatedJob.title, company: updatedJob.company,
      location: updatedJob.location, salary: updatedJob.salary, type: updatedJob.type, applyUrl: updatedJob.applyUrl, clicks: updatedJob.clicks,
      description: updatedJob.description, logoUrl: updatedJob.logoUrl
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update job" });
  }
});  

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server is live on http://localhost:${PORT}`);
});