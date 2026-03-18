import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs'; // 🌟 NEW: Password Hashing!
import crypto from 'crypto';   // 🌟 NEW: Built-in Node tool to generate magic tokens

dotenv.config(); 

const app = express();
app.use(helmet()); 

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, 
  legacyHeaders: false, 
});

app.use('/api/', limiter);
app.use(cors()); 
app.use(express.json()); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Vault!'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// --- 🌟 NEW: THE BOUNCER (Blocked Domains) ---
const freeEmailProviders = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 
  'icloud.com', 'aol.com', 'proton.me', 'protonmail.com'
];

// --- SCHEMAS ---
const jobSchema = new mongoose.Schema({
  title: String, company: String, location: String, salary: String,
  type: String, applyUrl: String, clicks: { type: Number, default: 0 },
  description: { type: String, default: '' }, logoUrl: { type: String, default: '' },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter' } // Link job to recruiter!
});
const Job = mongoose.model('Job', jobSchema);

// 🌟 NEW: RECRUITER SCHEMA
const recruiterSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  companyName: { type: String, required: true },
  isVerified: { type: Boolean, default: false }, // 🛡️ The Level 2 Shield!
  verificationToken: String
});
const Recruiter = mongoose.model('Recruiter', recruiterSchema);

// --- MIDDLEWARE ---
const requireAuth = (req, res, next) => {
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
    res.status(401).json({ error: "Unauthorized: Invalid token!" });
  }
};

// --- 🌟 NEW: AUTHENTICATION ROUTES ---

// 1. REGISTER (Corporate Emails Only)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, companyName } = req.body;
    
    // Check if email domain is banned
    const domain = email.split('@')[1].toLowerCase();
    if (freeEmailProviders.includes(domain)) {
      return res.status(400).json({ error: "Registration denied. Please use a corporate email address (e.g., @yourcompany.com)." });
    }

    // Check if user already exists
    const existingUser = await Recruiter.findOne({ email });
    if (existingUser) return res.status(400).json({ error: "Email already registered." });

    // Hash password and create token
    const hashedPassword = await bcrypt.hash(password, 10);
    const vToken = crypto.randomBytes(32).toString('hex');

    const newRecruiter = await Recruiter.create({
      email, password: hashedPassword, companyName, verificationToken: vToken
    });

    // 🚀 IN PRODUCTION: You would use SendGrid/Resend here to email this link.
    // For now, we will print it to the server console so you can "click" it!
    console.log(`\n📧 SIMULATED EMAIL TO: ${email}`);
    console.log(`Click here to verify your account: http://localhost:${process.env.PORT || 5000}/api/verify/${vToken}\n`);

    res.status(201).json({ message: "Registration successful! Please check your email to verify your account." });
  } catch (error) {
    res.status(500).json({ error: "Registration failed." });
  }
});

// 2. VERIFY EMAIL
app.get('/api/verify/:token', async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ verificationToken: req.params.token });
    if (!recruiter) return res.status(400).send("Invalid or expired verification link.");

    recruiter.isVerified = true;
    recruiter.verificationToken = undefined; // Clear the token so it can't be used again
    await recruiter.save();

    res.send("<h1>Email Verified! 🚀</h1><p>You can now return to Zero Static and log in.</p>");
  } catch (error) {
    res.status(500).send("Verification failed.");
  }
});

// 3. LOGIN (Checks for Verification!)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const recruiter = await Recruiter.findOne({ email });
    
    if (!recruiter) return res.status(401).json({ error: "Invalid credentials" });
    
    // 🛡️ ENFORCING LEVEL 2:
    if (!recruiter.isVerified) {
      return res.status(403).json({ error: "Please verify your corporate email before logging in." });
    }

    const isMatch = await bcrypt.compare(password, recruiter.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: recruiter._id, company: recruiter.companyName }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, companyName: recruiter.companyName });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

// --- JOB ROUTES (Updated to use requireAuth instead of requireAdmin) ---

app.get('/api/jobs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const jobs = await Job.find().sort({ _id: -1 }).skip((page - 1) * limit).limit(limit); 
    const totalJobs = await Job.countDocuments();
    const formattedJobs = jobs.map(j => ({ id: j._id, title: j.title, company: j.company, location: j.location, salary: j.salary, type: j.type, applyUrl: j.applyUrl, clicks: j.clicks, description: j.description, logoUrl: j.logoUrl }));
    res.json({ jobs: formattedJobs, currentPage: page, totalPages: Math.ceil(totalJobs / limit), totalJobs });
  } catch (error) { res.status(500).json({ error: "Failed to fetch jobs" }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const j = await Job.findById(req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found" });
    res.json({ id: j._id, title: j.title, company: j.company, location: j.location, salary: j.salary, type: j.type, applyUrl: j.applyUrl, clicks: j.clicks, description: j.description, logoUrl: j.logoUrl });
  } catch (error) { res.status(500).json({ error: "Failed to fetch job" }); }
});

app.patch('/api/jobs/:id/click', async (req, res) => {
  try { await Job.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } }); res.json({ message: "Click tracked" }); } 
  catch (error) { res.status(500).json({ error: "Failed to track click" }); }
});

// 🌟 POSTING JOBS NOW REQUIRES A VERIFIED RECRUITER
app.post('/api/jobs', requireAuth, async (req, res) => {
  try {
    // Automatically attach the logged-in recruiter's ID and Company Name to the job
    const newJob = await Job.create({ ...req.body, recruiterId: req.user.id, company: req.user.company }); 
    res.status(201).json({ id: newJob._id, title: newJob.title, company: newJob.company, location: newJob.location, salary: newJob.salary, type: newJob.type, applyUrl: newJob.applyUrl, clicks: newJob.clicks, description: newJob.description, logoUrl: newJob.logoUrl }); 
  } catch (error) { res.status(500).json({ error: "Failed to save job" }); }
});

app.delete('/api/jobs/:id', requireAuth, async (req, res) => {
  try { await Job.findByIdAndDelete(req.params.id); res.json({ message: "Job deleted" }); } 
  catch (error) { res.status(500).json({ error: "Failed to delete" }); }
}); 

app.put('/api/jobs/:id', requireAuth, async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedJob) return res.status(404).json({ error: "Job not found" });
    res.json({ id: updatedJob._id, title: updatedJob.title, company: updatedJob.company, location: updatedJob.location, salary: updatedJob.salary, type: updatedJob.type, applyUrl: updatedJob.applyUrl, clicks: updatedJob.clicks, description: updatedJob.description, logoUrl: updatedJob.logoUrl });
  } catch (error) { res.status(500).json({ error: "Failed to update" }); }
});  

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server is live on http://localhost:${PORT}`));