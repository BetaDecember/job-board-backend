import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. CLOUDINARY & SECURE VAULT UPLOAD SETUP
// ==========================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🌟 THE OFFICIAL SECURE PDF CONFIGURATION
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'resumes',
    format: async (req, file) => 'pdf', // Forces Cloudinary to append .pdf to the URL
  },
});

const upload = multer({ storage: storage });

// ==========================================
// 2. MONGODB SCHEMAS & MODELS
// ==========================================
const jobSchema = new mongoose.Schema({
  title: String,
  company: String,
  location: String,
  salary: String,
  type: String,
  applyUrl: String,
  description: String,
  logoUrl: String,
  clicks: { type: Number, default: 0 },
  employerId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now }
});

const employerSchema = new mongoose.Schema({
  companyName: String,
  email: { type: String, unique: true },
  password: { type: String, select: false }
});

const candidateSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: { type: String, select: false },
  resumeUrl: { type: String, default: '' }
});

const Job = mongoose.model('Job', jobSchema);
const Employer = mongoose.model('Employer', employerSchema);
const Candidate = mongoose.model('Candidate', candidateSchema);

// ==========================================
// 3. AUTHENTICATION MIDDLEWARES
// ==========================================
const verifyEmployer = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied" });
  try {
    req.employer = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch (err) { res.status(403).json({ error: "Invalid token" }); }
};

const verifyCandidate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied" });
  try {
    req.candidate = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch (err) { res.status(403).json({ error: "Invalid token" }); }
};

// ==========================================
// 4. EMPLOYER AUTH ROUTES
// ==========================================
app.post('/api/register', async (req, res) => {
  try {
    const { companyName, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await Employer.create({ companyName, email, password: hashedPassword });
    console.log(`✅ New Employer Registered: ${companyName}`); 
    res.status(201).json({ message: "Registration successful" });
  } catch (error) { res.status(400).json({ error: "Email already exists" }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const employer = await Employer.findOne({ email }).select('+password');
    if (!employer || !(await bcrypt.compare(password, employer.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: employer._id, companyName: employer.companyName }, process.env.JWT_SECRET || 'fallback_secret');
    res.json({ token, companyName: employer.companyName });
  } catch (error) { res.status(500).json({ error: "Server error" }); }
});

// ==========================================
// 5. JOB BOARD ROUTES
// ==========================================
app.get('/api/jobs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const jobs = await Job.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalJobs = await Job.countDocuments();
    
    const formattedJobs = jobs.map(j => ({ ...j._doc, id: j._id }));
    res.json({ jobs: formattedJobs, totalPages: Math.ceil(totalJobs / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ ...job._doc, id: job._id });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.patch('/api/jobs/:id/click', async (req, res) => {
  try {
    await Job.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
    res.json({ message: "Click recorded" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// Protected Employer Routes
app.post('/api/jobs', verifyEmployer, async (req, res) => {
  try {
    const newJob = await Job.create({ ...req.body, company: req.employer.companyName, employerId: req.employer.id });
    res.status(201).json({ ...newJob._doc, id: newJob._id });
  } catch (err) { res.status(500).json({ error: "Failed to create job" }); }
});

app.put('/api/jobs/:id', verifyEmployer, async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ ...updatedJob._doc, id: updatedJob._id });
  } catch (err) { res.status(500).json({ error: "Failed to update job" }); }
});

app.delete('/api/jobs/:id', verifyEmployer, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted" });
  } catch (err) { res.status(500).json({ error: "Failed to delete job" }); }
});

// ==========================================
// 6. CANDIDATE VAULT ROUTES
// ==========================================
app.post('/api/candidate/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await Candidate.create({ name, email, password: hashedPassword });
    res.status(201).json({ message: "Candidate registered successfully" });
  } catch (error) { res.status(400).json({ error: "Email already exists" }); }
});

app.post('/api/candidate/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const candidate = await Candidate.findOne({ email }).select('+password');
    if (!candidate || !(await bcrypt.compare(password, candidate.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: candidate._id }, process.env.JWT_SECRET || 'fallback_secret');
    res.json({ token, resumeUrl: candidate.resumeUrl });
  } catch (error) { res.status(500).json({ error: "Server error" }); }
});

// 🌟 THE PDF UPLOAD ROUTE
app.post('/api/candidate/resume', verifyCandidate, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // req.file.path contains the secure Cloudinary URL
    const secureUrl = req.file.path; 

    await Candidate.findByIdAndUpdate(req.candidate.id, { resumeUrl: secureUrl });
    res.json({ resumeUrl: secureUrl });
  } catch (error) { 
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload to vault" }); 
  }
});

// ==========================================
// 7. SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/jobboard')
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error("❌ MongoDB connection error:", err));