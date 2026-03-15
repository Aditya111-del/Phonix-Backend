import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/schemas/User.js';

dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

console.log('[Auth Routes] JWT_SECRET loaded:', JWT_SECRET.substring(0, 15) + '...');

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ 
        success: false,
        error: 'Name, email, and password are required' 
      });
    }

    const lowerEmail = email.toLowerCase();
    console.log('[Auth/Register] Attempting to register:', lowerEmail);

    // Check if user already exists
    const existingUser = await User.findOne({ email: lowerEmail });
    if (existingUser) {
      console.log('[Auth/Register] User already exists:', lowerEmail);
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }

    console.log('[Auth/Register] Email is available, creating user...');

    // Create new user (password will be hashed by pre-save middleware)
    const user = await User.create({
      email: lowerEmail,
      password,
      name,
      role: 'user',
    });

    console.log('[Auth/Register] User created successfully:', user._id, user.email);

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return success response
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('[Auth/Register] Error:', error.message, error.code);
    
    // Handle duplicate key error from MongoDB
    if (error.code === 11000) {
      console.error('[Auth/Register] Duplicate key error on field:', Object.keys(error.keyPattern));
      return res.status(400).json({ 
        success: false,
        error: 'This email is already registered' 
      });
    }
    
    if (error.message.includes('email already exists')) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already in use' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message || 'Registration failed' 
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password are required' 
      });
    }

    console.log('[Auth/Login] Attempting login for:', email);

    // Find user and explicitly select password field
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    // Check if user exists
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    console.log('[Auth/Login] User found:', user.email, 'role:', user.role);

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false,
        error: 'This account has been deactivated' 
      });
    }

    // Compare password
    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Generate JWT token
    console.log('[Auth/Login] Creating token with JWT_SECRET:', JWT_SECRET.substring(0, 10) + '...');
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('[Auth/Login] Token created successfully');

    // Return success response
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message || 'Login failed' 
    });
  }
});

// Google OAuth endpoint
router.post('/google', async (req, res) => {
  try {
    const { email, name, picture } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    // Check if user exists
    let user = await User.findOne({ email: email.toLowerCase() });

    // If not, create new user with Google OAuth
    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
        name: name || 'Google User',
        picture: picture || null,
        role: 'user',
        // Generate a random password for Google OAuth users (they won't use email/password login)
        password: `google-oauth-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return success response
    res.json({
      success: true,
      message: 'Google login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message || 'Google login failed' 
    });
  }
});

export default router;

