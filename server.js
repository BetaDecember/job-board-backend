import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
// 🌟 NEW: CLOUDINARY IMPORTS
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

dotenv.config(); 

const app = express();
app.use(helmet()); 

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);
app.use(cors()); 
app.use(express.json()); 

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Vault!'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

// --- 🌟 CLOUDINARY CONFIGURATION ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'zero_static_resumes',
    format: async (req, file) => 'pdf', // Force PDF format
  },
});
const upload = multer({ storage: storage });

// --- EMAIL CONFIGURATION (Gmail Bypass) ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
const freeEmailProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com'];

// --- SCHEMAS ---
const jobSchema = new mongoose.Schema({
  title: String, company: String, location: String, salary: String, type: String, applyUrl: String, clicks: { type: Number, default: 0 },
  description: { type: String, default: '' }, logoUrl: { type: String, default: '' },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter' }
});
const Job = mongoose.model('Job', jobSchema);

const recruiterSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true }, password: { type: String, required: true },
  companyName: { type: String, required: true }, isVerified: { type: Boolean, default: false }, verificationToken: String
});
const Recruiter = mongoose.model('Recruiter', recruiterSchema);

// 🌟 NEW: CANDIDATE & APPLICATION SCHEMAS
const candidateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resumeUrl: { type: String, default: '' },
  resumeId: { type: String, default: '' }
}, { timestamps: true });
const Candidate = mongoose.model('Candidate', candidateSchema);

const applicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recruiter', required: true },
  resumeUrl: { type: String, required: true },
  status: { type: String, default: 'Pending', enum: ['Pending', 'Reviewed', 'Rejected', 'Accepted'] }
}, { timestamps: true });
applicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true }); // Prevent applying to the same job twice
const Application = mongoose.model('Application', applicationSchema);

// --- MIDDLEWARE ---
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: "Unauthorized: No token provided!" });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded; next(); 
  } catch (error) { res.status(401).json({ error: "Unauthorized: Invalid token!" }); }
};

// --- ROUTES: RECRUITER AUTH ---
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, companyName } = req.body;
    const domain = email.split('@')[1].toLowerCase();
    
    if (freeEmailProviders.includes(domain)) return res.status(400).json({ error: "Please use a corporate email address." });
    if (await Recruiter.findOne({ email })) return res.status(400).json({ error: "Email already registered." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const vToken = crypto.randomBytes(32).toString('hex');
    await Recruiter.create({ email, password: hashedPassword, companyName, verificationToken: vToken });

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
    const verifyLink = `${backendUrl}/api/verify/${vToken}`;

    await transporter.sendMail({
      from: `"Zero Static Team" <${process.env.EMAIL_USER}>`, to: email, subject: 'Verify your Employer Account',
      html: `<h2>Welcome, ${companyName}!</h2><p>Click below to verify your account:</p><a href="${verifyLink}">Verify My Account</a>`
    });

    res.status(201).json({ message: "Registration successful! Please check your email." });
  } catch (error) { res.status(500).json({ error: "Registration failed." }); }
});

app.get('/api/verify/:token', async (req, res) => {
  try {
    const recruiter = await Recruiter.findOne({ verificationToken: req.params.token });
    if (!recruiter) return res.status(400).send("Invalid or expired verification link.");
    recruiter.isVerified = true; recruiter.verificationToken = undefined; await recruiter.save();
    res.send("<h1>Email Verified! 🚀</h1><p>You can now log in.</p>");
  } catch (error) { res.status(500).send("Verification failed."); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const recruiter = await Recruiter.findOne({ email });
    if (!recruiter || !recruiter.isVerified) return res.status(401).json({ error: "Invalid credentials or unverified email." });
    if (!(await bcrypt.compare(password, recruiter.password))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ id: recruiter._id, company: recruiter.companyName, role: 'recruiter' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, companyName: recruiter.companyName });
  } catch (error) { res.status(500).json({ error: "Login failed" }); }
});

// --- 🌟 ROUTES: CANDIDATE AUTH & RESUMES ---
app.post('/api/candidate/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (await Candidate.findOne({ email })) return res.status(400).json({ error: "Email already exists." });
    const hashedPassword = await bcrypt.hash(password, 10);
    await Candidate.create({ name, email, password: hashedPassword });
    res.status(201).json({ message: "Candidate registered successfully!" });
  } catch (error) { res.status(500).json({ error: "Registration failed." }); }
});

app.post('/api/candidate/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const candidate = await Candidate.findOne({ email });
    if (!candidate || !(await bcrypt.compare(password, candidate.password))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ id: candidate._id, name: candidate.name, role: 'candidate' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, name: candidate.name, resumeUrl: candidate.resumeUrl });
  } catch (error) { res.status(500).json({ error: "Login failed" }); }
});

app.post('/api/candidate/resume', requireAuth, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    if (req.user.role !== 'candidate') return res.status(403).json({ error: "Only candidates can upload resumes." });

    const candidate = await Candidate.findByIdAndUpdate(
      req.user.id, { resumeUrl: req.file.path, resumeId: req.file.filename }, { new: true }
    );
    res.json({ message: "Resume uploaded securely!", resumeUrl: candidate.resumeUrl });
  } catch (error) { res.status(500).json({ error: "Failed to upload resume." }); }
});

// --- ROUTES: JOBS ---
app.get('/api/jobs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; const limit = parseInt(req.query.limit) || 10;
    const jobs = await Job.find().sort({ _id: -1 }).skip((page - 1) * limit).limit(limit); 
    const totalJobs = await Job.countDocuments();
    res.json({ jobs: jobs.map(j => ({ id: j._id, ...j._doc })), currentPage: page, totalPages: Math.ceil(totalJobs / limit), totalJobs });
  } catch (error) { res.status(500).json({ error: "Failed to fetch jobs" }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const j = await Job.findById(req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found" });
    res.json({ id: j._id, ...j._doc });
  } catch (error) { res.status(500).json({ error: "Failed to fetch job" }); }
});

app.patch('/api/jobs/:id/click', async (req, res) => {
  try { await Job.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } }); res.json({ message: "Click tracked" }); } 
  catch (error) { res.status(500).json({ error: "Failed to track click" }); }
});

app.post('/api/jobs', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'recruiter') return res.status(403).json({ error: "Only recruiters can post jobs." });
    const newJob = await Job.create({ ...req.body, recruiterId: req.user.id, company: req.user.company }); 
    res.status(201).json({ id: newJob._id, ...newJob._doc }); 
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
    res.json({ id: updatedJob._id, ...updatedJob._doc });
  } catch (error) { res.status(500).json({ error: "Failed to update" }); }
});  

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server is live on http://localhost:${PORT}`));